import { BleManager, Device, Subscription, BleError } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid, NativeModules, NativeEventEmitter } from 'react-native';
import { Buffer } from 'buffer';
import * as BluetoothClient from '../bluetooth';

// ========================
// BLE 상수
// ========================
export const BLE_SERVICE_UUID = '550e8400-e29b-41d4-a716-446655440000';

export const BLE_CHARACTERISTICS = {
  CODE_VERIFY: '550e8401-e29b-41d4-a716-446655440001',
  JWT_TOKEN: '550e8402-e29b-41d4-a716-446655440002',
  STATUS: '550e8403-e29b-41d4-a716-446655440003',
};

// 기존 호환성을 위한 별칭
export const BLE_WRITE_CHARACTERISTIC = BLE_CHARACTERISTICS.CODE_VERIFY;

export const CONNECTION_CODE_LENGTH = 6;
export const CODE_EXPIRY_TIME = 5 * 60 * 1000;
export const BLE_MTU_SIZE = 20;
export const BLE_CHUNK_DATA_SIZE = 18;
export const CONNECTION_TIMEOUT = 30000;
export const RETRY_ATTEMPTS = 3;

// ========================
// 유틸리티 함수들
// ========================
export const generateConnectionCode = (): string => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: CONNECTION_CODE_LENGTH }, () => 
    characters.charAt(Math.floor(Math.random() * characters.length))
  ).join('');
};

export const generateSerialNumber = (): string => {
  const timestamp = Date.now().toString().slice(-6);
  return `TAB-${timestamp}`;
};

export const generateJwtToken = (serialNumber: string): string => {
  const mockPayload = {
    deviceId: serialNumber,
    userId: 'user123',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24)
  };
  
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify(mockPayload));
  const signature = 'mock-signature-' + Date.now();
  
  return `${header}.${payload}.${signature}`;
};

export const isIoTDevice = (deviceName: string | null): boolean => {
  if (!deviceName) return false;
  const patterns = ['IoT-', 'TAB-', 'TABLET-', 'MOBILE-', 'BLE-'];
  return patterns.some(pattern => 
    deviceName.toUpperCase().includes(pattern.toUpperCase())
  );
};

export const getDataType = (data: string): 'connectionCode' | 'serialNumber' | 'jwtToken' | 'unknown' => {
  if (data.length === CONNECTION_CODE_LENGTH && /^[A-Z0-9]+$/.test(data)) return 'connectionCode';
  if (data.startsWith('TAB-') || data.startsWith('IOT-') || data.startsWith('TABLET-')) return 'serialNumber';
  if (data.startsWith('eyJ')) return 'jwtToken';
  return 'unknown';
};

export const validateConnectionCode = (code: string): boolean => {
  return code.length === CONNECTION_CODE_LENGTH && /^[A-Z0-9]+$/.test(code);
};

export const simulateServerRequest = async (serialNumber: string): Promise<string> => {
  await new Promise(resolve => setTimeout(resolve, 2000));
  return generateJwtToken(serialNumber);
};

// ========================
// BLE 관리
// ========================
let bleManagerInstance: BleManager | null = null;

export const getBleManager = (): BleManager => {
  if (!bleManagerInstance) {
    bleManagerInstance = new BleManager();
  }
  return bleManagerInstance;
};

export const requestPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;
  
  const permissions = Platform.Version >= 31 
    ? [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]
    : [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ];
  
  const results = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(results).every(result => result === PermissionsAndroid.RESULTS.GRANTED);
};

// ========================
// Central 모드 (모바일)
// ========================
export const scanForDevices = (
  onDeviceFound: (device: Device) => void,
  onError?: (error: BleError) => void
): void => {
  const manager = getBleManager();
  manager.startDeviceScan(null, null, (error, device) => {
    if (error) {
      onError?.(error);
      return;
    }
    if (device) onDeviceFound(device);
  });
};

export const stopScan = (): void => {
  getBleManager().stopDeviceScan();
};

export const connectToDevice = async (deviceId: string): Promise<Device> => {
  const manager = getBleManager();
  const device = await manager.connectToDevice(deviceId);
  return await device.discoverAllServicesAndCharacteristics();
};

export const disconnectDevice = async (device: Device): Promise<void> => {
  await device.cancelConnection();
};

export const writeData = async (
  device: Device,
  serviceUUID: string,
  characteristicUUID: string,
  message: string
): Promise<void> => {
  const base64Message = Buffer.from(message, 'utf-8').toString('base64');
  await device.writeCharacteristicWithResponseForService(
    serviceUUID,
    characteristicUUID,
    base64Message
  );
};

export const monitorCharacteristic = (
  device: Device,
  serviceUUID: string,
  characteristicUUID: string,
  onDataReceived: (data: string) => void,
  onError?: (error: BleError) => void
): Subscription => {
  return device.monitorCharacteristicForService(
    serviceUUID,
    characteristicUUID,
    (error, characteristic) => {
      if (error) {
        onError?.(error);
        return;
      }
      if (characteristic?.value) {
        const data = Buffer.from(characteristic.value, 'base64').toString('utf-8');
        onDataReceived(data);
      }
    }
  );
};

// ========================
// Peripheral 모드 (태블릿)
// ========================
export const checkBluetoothClient = async (): Promise<boolean> => {
  try {
    await BluetoothClient.checkBluetooth();
    return true;
  } catch {
    return false;
  }
};

export const setupPeripheralService = async (
  serviceUUID: string,
  characteristicUUID: string
): Promise<void> => {
  try {
    await BluetoothClient.removeAllServices();
  } catch {
    // 무시
  }
  
  await BluetoothClient.addService(serviceUUID, true);
  await BluetoothClient.addCharacteristicToService(
    serviceUUID,
    characteristicUUID,
    16, // Write permission
    2 | 8 | 16, // Read + Write + Notify properties
    ''
  );
};

export const startAdvertising = async (deviceName: string): Promise<void> => {
  await BluetoothClient.setName(deviceName);
  await BluetoothClient.startAdvertising(0);
};

export const stopAdvertising = async (): Promise<void> => {
  await BluetoothClient.stopAdvertising();
};

export const setupDataListener = (
  onDataReceived: (deviceId: string, data: string) => void
): (() => void) => {
  const BluetoothClientModule = NativeModules.BluetoothClient;
  
  if (!BluetoothClientModule || typeof BluetoothClientModule.addListener !== 'function') {
    return () => {};
  }
  
  let eventEmitter;
  try {
    eventEmitter = new NativeEventEmitter(BluetoothClientModule);
  } catch {
    return () => {};
  }
  
  const subscription = eventEmitter.addListener('onReceiveData', (event: any) => {
    try {
      let receivedString = '';
      if (event.data && Array.isArray(event.data)) {
        receivedString = String.fromCharCode(...event.data);
      } else if (typeof event.data === 'string') {
        receivedString = event.data;
      }
      onDataReceived(event.device || 'unknown', receivedString);
    } catch (error) {
      console.error('데이터 수신 처리 오류:', error);
    }
  });
  
  return () => {
    try {
      subscription.remove();
    } catch (error) {
      console.error('리스너 제거 실패:', error);
    }
  };
};

export const sendNotification = async (
  serviceUUID: string,
  characteristicUUID: string,
  message: string
): Promise<void> => {
  await BluetoothClient.sendNotificationToDevice(
    serviceUUID,
    characteristicUUID,
    message
  );
};

// ========================
// 고수준 비즈니스 플로우
// ========================
export const startIoTRegistration = async (
  device: Device,
  connectionCode: string,
  onStatusUpdate: (status: string) => void,
  onComplete: (result: { serialNumber: string; jwtToken: string }) => void,
  onError: (error: string) => void
): Promise<Subscription> => {
  try {
    onStatusUpdate('연결 코드 전송 중...');
    await writeData(device, BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, connectionCode);
    onStatusUpdate('연결 코드 전송 완료 - 시리얼 번호 대기 중...');
    
    return monitorCharacteristic(
      device,
      BLE_SERVICE_UUID,
      BLE_WRITE_CHARACTERISTIC,
      async (data) => {
        const dataType = getDataType(data);
        
        if (dataType === 'serialNumber') {
          onStatusUpdate('시리얼 번호 수신 - JWT 토큰 생성 중...');
          
          try {
            const jwtToken = await simulateServerRequest(data);
            onStatusUpdate('JWT 토큰 전송 중...');
            await writeData(device, BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, jwtToken);
            onStatusUpdate('IoT 기기 등록 완료!');
            onComplete({ serialNumber: data, jwtToken });
          } catch {
            onError('JWT 토큰 처리 실패');
          }
        }
      },
      () => onError('데이터 모니터링 오류')
    );
  } catch {
    onError('연결 코드 전송 실패');
    throw new Error('연결 코드 전송 실패');
  }
};

export const handleIoTRegistrationData = async (
  deviceId: string,
  data: string,
  serialNumber: string,
  onStatusUpdate: (status: string) => void,
  onComplete: (result: { connectionCode: string; serialNumber: string; jwtToken: string }) => void
): Promise<void> => {
  const dataType = getDataType(data);
  
  try {
    switch (dataType) {
      case 'connectionCode':
        if (validateConnectionCode(data)) {
          onStatusUpdate(`연결 코드 수신: ${data} - 시리얼 번호 전송 중...`);
          setTimeout(async () => {
            try {
              await sendNotification(BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, serialNumber);
              onStatusUpdate(`시리얼 번호 전송 완료: ${serialNumber} - JWT 대기 중...`);
            } catch {
              onStatusUpdate('시리얼 번호 전송 실패');
            }
          }, 1000);
        }
        break;
        
      case 'jwtToken':
        onStatusUpdate('🎉 IoT 기기 등록 완료!');
        onComplete({ 
          connectionCode: '', 
          serialNumber, 
          jwtToken: data 
        });
        break;
    }
  } catch {
    onStatusUpdate('데이터 처리 실패');
  }
};

export const initializePeripheralMode = async (
  deviceName: string,
  onDataReceived: (deviceId: string, data: string) => void,
  onStatusUpdate: (status: string) => void
): Promise<() => void> => {
  onStatusUpdate('BLE 서비스 설정 중...');
  await setupPeripheralService(BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC);
  
  onStatusUpdate('데이터 리스너 설정 중...');
  const cleanupListener = setupDataListener(onDataReceived);
  
  onStatusUpdate('Advertising 시작 중...');
  await startAdvertising(deviceName);
  
  onStatusUpdate('연결 대기 중...');
  return cleanupListener;
};

export const cleanup = (): void => {
  if (bleManagerInstance) {
    bleManagerInstance.destroy();
    bleManagerInstance = null;
  }
};