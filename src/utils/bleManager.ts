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
  // JWT 토큰은 eyJ로 시작하고 최소 2개의 .이 있어야 완전한 토큰
  if (data.startsWith('eyJ') && (data.match(/\./g) || []).length >= 2) return 'jwtToken';
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
  try {
    await BluetoothClient.stopAdvertising();
  } catch (error) {
    console.error('stopAdvertising 오류:', error);
    // 에러가 발생해도 무시 (이미 중지된 상태일 수 있음)
  }
};

export const setupDataListener = (
  onDataReceived: (deviceId: string, data: string) => void
): (() => void) => {
  console.log('[setupDataListener] 이벤트 리스너 설정 시작');
  
  const BluetoothClientModule = NativeModules.BluetoothClient;
  
  if (!BluetoothClientModule) {
    console.error('[setupDataListener] BluetoothClientModule이 없습니다');
    return () => {};
  }
  
  console.log('[setupDataListener] BluetoothClientModule 확인됨');
  
  let eventEmitter;
  try {
    eventEmitter = new NativeEventEmitter(BluetoothClientModule);
    console.log('[setupDataListener] NativeEventEmitter 생성 성공');
  } catch (error) {
    console.error('[setupDataListener] NativeEventEmitter 생성 실패:', error);
    return () => {};
  }
  
  console.log('[setupDataListener] onReceiveData 이벤트 리스너 등록 중...');
  const subscription = eventEmitter.addListener('onReceiveData', (event: any) => {
    console.log('[setupDataListener] onReceiveData 이벤트 수신:', event);
    
    try {
      let receivedString = '';
      if (event.data && Array.isArray(event.data)) {
        receivedString = String.fromCharCode(...event.data);
        console.log('[setupDataListener] 배열에서 문자열 변환:', receivedString);
      } else if (typeof event.data === 'string') {
        receivedString = event.data;
        console.log('[setupDataListener] 문자열 직접 사용:', receivedString);
      } else {
        console.error('[setupDataListener] 알 수 없는 데이터 형식:', event.data);
        return;
      }
      
      const deviceId = event.device || 'unknown';
      console.log('[setupDataListener] 데이터 처리 완료, 콜백 호출:', { deviceId, receivedString });
      onDataReceived(deviceId, receivedString);
    } catch (error) {
      console.error('[setupDataListener] 데이터 수신 처리 오류:', error);
    }
  });
  
  console.log('[setupDataListener] 이벤트 리스너 등록 완료');
  
  return () => {
    try {
      console.log('[setupDataListener] 이벤트 리스너 제거 중...');
      subscription.remove();
      console.log('[setupDataListener] 이벤트 리스너 제거 완료');
    } catch (error) {
      console.error('[setupDataListener] 리스너 제거 실패:', error);
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
  console.log('[startIoTRegistration] 시작:', { deviceId: device.id, connectionCode });
  
  try {
    onStatusUpdate('연결 코드 전송 중...');
    console.log('[startIoTRegistration] 연결 코드 전송 시작');
    
    await writeData(device, BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, connectionCode);
    console.log('[startIoTRegistration] 연결 코드 전송 완료');
    onStatusUpdate('연결 코드 전송 완료 - 시리얼 번호 대기 중...');
    
    console.log('[startIoTRegistration] 모니터링 시작');
    return monitorCharacteristic(
      device,
      BLE_SERVICE_UUID,
      BLE_WRITE_CHARACTERISTIC,
      async (data) => {
        const dataType = getDataType(data);
        console.log('[startIoTRegistration] 데이터 수신:', { data, dataType });
        
        if (dataType === 'serialNumber') {
          console.log('[startIoTRegistration] 시리얼 번호 수신:', data);
          onStatusUpdate('시리얼 번호 수신 - JWT 토큰 생성 중...');
          
          try {
            const jwtToken = await simulateServerRequest(data);
            console.log('[startIoTRegistration] JWT 토큰 생성 완료');
            onStatusUpdate('JWT 토큰 전송 중...');
            
            // START 마크와 함께 JWT 토큰 전송 시작
            const markedJwtToken = `START${jwtToken}END`;
            console.log('[startIoTRegistration] START/END 마크가 포함된 JWT 토큰 전송:', markedJwtToken.length + '글자');
            
            await writeData(device, BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, markedJwtToken);
            console.log('[startIoTRegistration] JWT 토큰 전송 완료');
            
            // JWT 토큰 전송 완료 후 바로 완료 처리 (더 이상 응답 대기하지 않음)
            onStatusUpdate('IoT 기기 등록 완료!');
            onComplete({ serialNumber: data, jwtToken });
            
          } catch (error) {
            console.error('[startIoTRegistration] JWT 토큰 처리 실패:', error);
            onError('JWT 토큰 처리 실패');
          }
        } else {
          console.log('[startIoTRegistration] 예상하지 못한 데이터 타입:', { data, dataType });
        }
      },
      (error) => {
        console.error('[startIoTRegistration] 모니터링 오류:', error);
        onError('데이터 모니터링 오류');
      }
    );
  } catch (error) {
    console.error('[startIoTRegistration] 연결 코드 전송 실패:', error);
    onError('연결 코드 전송 실패');
    throw new Error('연결 코드 전송 실패');
  }
};

// 청크 데이터를 관리하기 위한 맵
const deviceDataChunks = new Map<string, string>();
// 각 기기별로 받은 연결 코드를 저장
const deviceConnectionCodes = new Map<string, string>();

export const handleIoTRegistrationData = async (
  deviceId: string,
  data: string,
  serialNumber: string,
  onStatusUpdate: (status: string) => void,
  onComplete: (result: { connectionCode: string; serialNumber: string; jwtToken: string }) => void
): Promise<void> => {
  const dataType = getDataType(data);
  
  console.log('[handleIoTRegistrationData] 받은 데이터:', { deviceId, data, dataType, serialNumber });
  
  try {
    switch (dataType) {
      case 'connectionCode':
        if (validateConnectionCode(data)) {
          // 새로운 세션 시작 - 기존 청크 데이터 정리
          deviceDataChunks.delete(deviceId);
          // 연결 코드 저장
          deviceConnectionCodes.set(deviceId, data);
          
          onStatusUpdate(`연결 코드 수신: ${data} - 시리얼 번호 전송 중...`);
          console.log('[handleIoTRegistrationData] 유효한 연결 코드 수신, 시리얼 번호 전송 시작');
          
          // 즉시 시리얼 번호 전송 시도
          try {
            await sendNotification(BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, serialNumber);
            onStatusUpdate(`시리얼 번호 전송 완료: ${serialNumber} - JWT 대기 중...`);
            console.log('[handleIoTRegistrationData] 시리얼 번호 전송 성공:', serialNumber);
          } catch (error) {
            console.error('[handleIoTRegistrationData] 시리얼 번호 전송 실패:', error);
            onStatusUpdate('시리얼 번호 전송 실패 - 재시도 중...');
            
            // 1초 후 재시도
            setTimeout(async () => {
              try {
                await sendNotification(BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, serialNumber);
                onStatusUpdate(`시리얼 번호 전송 완료: ${serialNumber} - JWT 대기 중...`);
                console.log('[handleIoTRegistrationData] 시리얼 번호 재전송 성공:', serialNumber);
              } catch (retryError) {
                console.error('[handleIoTRegistrationData] 시리얼 번호 재전송 실패:', retryError);
                onStatusUpdate('시리얼 번호 전송 실패');
              }
            }, 1000);
          }
        } else {
          console.error('[handleIoTRegistrationData] 유효하지 않은 연결 코드:', data);
          onStatusUpdate('유효하지 않은 연결 코드');
        }
        break;
        
      case 'jwtToken':
        console.log('[handleIoTRegistrationData] JWT 토큰 수신:', data.substring(0, 50) + '...');
        onStatusUpdate('🎉 IoT 기기 등록 완료!');
        const storedConnectionCode = deviceConnectionCodes.get(deviceId) || '';
        onComplete({ 
          connectionCode: storedConnectionCode, 
          serialNumber, 
          jwtToken: data 
        });
        // 완료 후 데이터 정리
        deviceDataChunks.delete(deviceId);
        deviceConnectionCodes.delete(deviceId);
        break;
        
      default:
        // START/END 마크를 포함한 JWT 토큰 처리
        const existingChunks = deviceDataChunks.get(deviceId) || '';
        const combinedData = existingChunks + data;
        deviceDataChunks.set(deviceId, combinedData);
        
        console.log('[handleIoTRegistrationData] 청크 수집:', { 
          newChunk: data.substring(0, 20) + '...', 
          totalLength: combinedData.length 
        });
        
        // START 마크 확인
        if (combinedData.includes('START')) {
          console.log('[handleIoTRegistrationData] START 마크 감지 - JWT 토큰 수집 시작');
          onStatusUpdate('JWT 토큰 수신 시작...');
        }
        
        // END 마크 확인
        if (combinedData.includes('END')) {
          console.log('[handleIoTRegistrationData] END 마크 감지 - JWT 토큰 수집 완료');
          
          // START와 END 사이의 JWT 토큰 추출
          const startIndex = combinedData.indexOf('START') + 5; // 'START' 길이만큼 건너뛰기
          const endIndex = combinedData.indexOf('END');
          
          if (startIndex >= 5 && endIndex > startIndex) {
            const jwtToken = combinedData.substring(startIndex, endIndex);
            console.log('[handleIoTRegistrationData] JWT 토큰 추출 완료:', jwtToken.substring(0, 50) + '...');
            
            onStatusUpdate('🎉 IoT 기기 등록 완료!');
            const storedConnectionCode = deviceConnectionCodes.get(deviceId) || '';
            onComplete({ 
              connectionCode: storedConnectionCode, 
              serialNumber, 
              jwtToken: jwtToken 
            });
            
            // 완료 후 데이터 정리
            deviceDataChunks.delete(deviceId);
            deviceConnectionCodes.delete(deviceId);
          } else {
            console.error('[handleIoTRegistrationData] START/END 마크 파싱 오류');
            onStatusUpdate('JWT 토큰 파싱 오류');
          }
        } else {
          // 아직 END 마크가 없으면 계속 수집
          // JWT 토큰 예상 길이를 기준으로 진행률 계산 (대략 150-200글자)
          const estimatedTotal = 180;
          const progress = Math.min(95, Math.floor((combinedData.length / estimatedTotal) * 100));
          onStatusUpdate(`JWT 토큰 수신 중... (${progress}%)`);
        }
    }
  } catch (error) {
    console.error('[handleIoTRegistrationData] 데이터 처리 오류:', error);
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