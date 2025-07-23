import { BleManager, Device, Subscription, BleError } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid, NativeModules, NativeEventEmitter } from 'react-native';
import { Buffer } from 'buffer';
import * as BluetoothClient from '../bluetooth';
import { 
  BLE_SERVICE_UUID, 
  BLE_WRITE_CHARACTERISTIC,
  getDataType,
  validateConnectionCode,
  simulateServerRequest
} from './bleUtils';

// BLE Manager 싱글톤 인스턴스
let bleManagerInstance: BleManager | null = null;

export const getBleManager = (): BleManager => {
  if (!bleManagerInstance) {
    bleManagerInstance = new BleManager();
  }
  return bleManagerInstance;
};

// 권한 요청
export const requestPermissions = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    if (Platform.Version >= 31) {
      // Android 12+ (API 31+) - 새로운 블루투스 권한 사용
      console.log('Android 12+ 권한 요청');
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];
      
      const results = await PermissionsAndroid.requestMultiple(permissions);
      const allGranted = Object.values(results).every(
        result => result === PermissionsAndroid.RESULTS.GRANTED
      );
      
      return allGranted;
    } else {
      // Android 11 이하 (API 30 이하) - 위치 권한만 필요
      console.log('Android 11 이하 권한 요청 (위치 권한만, BLUETOOTH_ADVERTISE 제외)');
      const permissions = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ];
      
      // Android 11에서는 BLUETOOTH_ADVERTISE 권한을 절대 요청하지 않음
      console.log('Android 11: BLUETOOTH_ADVERTISE 권한 요청 건너뜀');
      
      const results = await PermissionsAndroid.requestMultiple(permissions);
      
      // 결과 로깅
      Object.entries(results).forEach(([permission, result]) => {
        console.log(`권한 ${permission}: ${result}`);
      });
      
      const allGranted = Object.values(results).every(
        result => result === PermissionsAndroid.RESULTS.GRANTED
      );
      
      console.log('모든 권한 부여됨:', allGranted);
      return allGranted;
    }
  }
  return true; // iOS
};

// Central 모드 - 장치 스캔
export const scanForDevices = (
  onDeviceFound: (device: Device) => void,
  onError?: (error: BleError) => void
): void => {
  const manager = getBleManager();
  
  manager.startDeviceScan(null, null, (error, device) => {
    if (error) {
      console.error('스캔 에러:', error);
      onError?.(error);
      return;
    }

    if (device) {
      console.log(`디바이스 발견: ${device.name || 'Unknown'} (${device.id})`);
      onDeviceFound(device);
    }
  });
};

// 스캔 중지
export const stopScan = (): void => {
  const manager = getBleManager();
  manager.stopDeviceScan();
};

// 장치 연결
export const connectToDevice = async (deviceId: string): Promise<Device> => {
  try {
    const manager = getBleManager();
    const device = await manager.connectToDevice(deviceId);
    console.log('장치에 연결되었습니다:', device.id);
    
    const services = await device.discoverAllServicesAndCharacteristics();
    console.log('서비스 및 특성 탐색 완료');
    
    return services;
  } catch (error) {
    console.error(`장치 연결 실패: ${error}`);
    throw error;
  }
};

// 장치 연결 해제
export const disconnectDevice = async (device: Device): Promise<void> => {
  try {
    await device.cancelConnection();
    console.log('장치 연결이 해제되었습니다');
  } catch (error) {
    console.error('연결 해제 실패:', error);
    throw error;
  }
};

// 데이터 쓰기
export const writeData = async (
  device: Device,
  serviceUUID: string,
  characteristicUUID: string,
  message: string
): Promise<void> => {
  try {
    const base64Message = Buffer.from(message, 'utf-8').toString('base64');
    await device.writeCharacteristicWithResponseForService(
      serviceUUID,
      characteristicUUID,
      base64Message
    );
    console.log('데이터 전송 성공:', message);
  } catch (error) {
    console.error(`데이터 전송 실패: ${error}`);
    throw error;
  }
};

// 특성 모니터링
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
        console.error('모니터링 에러:', error);
        onError?.(error);
        return;
      }
      
      if (characteristic?.value) {
        const data = Buffer.from(characteristic.value, 'base64').toString('utf-8');
        console.log('모니터링 데이터 수신:', data);
        onDataReceived(data);
      }
    }
  );
};

// 연결 상태 모니터링
export const onDeviceDisconnected = (
  deviceId: string,
  callback: (error: BleError | null, device: Device | null) => void
): Subscription => {
  const manager = getBleManager();
  return manager.onDeviceDisconnected(deviceId, callback);
};

// ========================
// Peripheral 모드 기능들
// ========================

// Bluetooth 상태 확인
export const checkBluetoothClient = async (): Promise<boolean> => {
  try {
    await BluetoothClient.checkBluetooth();
    console.log('BluetoothClient 상태 확인 완료');
    return true;
  } catch (error) {
    console.error('BluetoothClient 상태 확인 실패:', error);
    return false;
  }
};

// Peripheral 서비스 설정
export const setupPeripheralService = async (
  serviceUUID: string,
  characteristicUUID: string
): Promise<void> => {
  try {
    console.log('기존 서비스 제거 중...');
    try {
      await BluetoothClient.removeAllServices();
      console.log('기존 서비스 제거 완료');
    } catch (removeError) {
      console.log('기존 서비스 제거 실패 (무시됨):', removeError);
      // Android 11에서 서비스가 없을 때 발생하는 오류 무시
    }
    
    console.log('새 서비스 추가 중...');
    await BluetoothClient.addService(serviceUUID, true); // Primary service
    
    console.log('특성 추가 중...');
    await BluetoothClient.addCharacteristicToService(
      serviceUUID,
      characteristicUUID,
      16, // Write permission
      2 | 8 | 16, // Read + Write + Notify properties
      ''
    );
    
    console.log('Peripheral 서비스 설정 완료');
  } catch (error) {
    console.error('Peripheral 서비스 설정 실패:', error);
    throw error;
  }
};

// Advertising 시작
export const startAdvertising = async (deviceName: string): Promise<void> => {
  try {
    console.log('기기명 설정:', deviceName);
    await BluetoothClient.setName(deviceName);
    
    console.log('Advertising 시작...');
    await BluetoothClient.startAdvertising(0); // 0 = 무한
    
    console.log('Advertising 시작 성공');
  } catch (error) {
    console.error('Advertising 시작 실패:', error);
    throw error;
  }
};

// Advertising 중지
export const stopAdvertising = async (): Promise<void> => {
  try {
    await BluetoothClient.stopAdvertising();
    console.log('Advertising 중지됨');
  } catch (error) {
    console.error('Advertising 중지 실패:', error);
    throw error;
  }
};

// 데이터 수신 이벤트 리스너 설정
export const setupDataListener = (
  onDataReceived: (deviceId: string, data: string) => void
): (() => void) => {
  const BluetoothClientModule = NativeModules.BluetoothClient;
  
  if (!BluetoothClientModule) {
    console.error('BluetoothClient module not found');
    return () => {};
  }
  
  // NativeEventEmitter가 제대로 된 모듈인지 확인
  if (typeof BluetoothClientModule.addListener !== 'function') {
    console.warn('BluetoothClient module does not have addListener method, using fallback');
    return () => {};
  }
  
  let eventEmitter;
  try {
    eventEmitter = new NativeEventEmitter(BluetoothClientModule);
  } catch (error) {
    console.error('NativeEventEmitter 생성 실패:', error);
    return () => {};
  }
  
  const subscription = eventEmitter.addListener('onReceiveData', (event: any) => {
    try {
      console.log('Raw event data:', event);
      
      // bytesToString 대신 직접 변환
      let receivedString = '';
      if (event.data && Array.isArray(event.data)) {
        receivedString = String.fromCharCode(...event.data);
      } else if (typeof event.data === 'string') {
        receivedString = event.data;
      }
      
      console.log('수신된 데이터:', receivedString);
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

// 알림 전송
export const sendNotification = async (
  serviceUUID: string,
  characteristicUUID: string,
  message: string
): Promise<void> => {
  try {
    await BluetoothClient.sendNotificationToDevice(
      serviceUUID,
      characteristicUUID,
      message
    );
    console.log('알림 전송 성공:', message);
  } catch (error) {
    console.error('알림 전송 실패:', error);
    throw error;
  }
};

// ========================
// 고수준 비즈니스 플로우
// ========================

// 모바일: IoT 등록 플로우 시작
export const startIoTRegistration = async (
  device: Device,
  connectionCode: string,
  onStatusUpdate: (status: string) => void,
  onComplete: (result: { serialNumber: string; jwtToken: string }) => void,
  onError: (error: string) => void
): Promise<Subscription> => {
  try {
    onStatusUpdate('연결 코드 전송 중...');
    
    // 1. 연결 코드 전송
    await writeData(device, BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, connectionCode);
    onStatusUpdate('연결 코드 전송 완료 - 시리얼 번호 대기 중...');
    
    // 2. 시리얼 번호 수신 모니터링
    return monitorCharacteristic(
      device,
      BLE_SERVICE_UUID,
      BLE_WRITE_CHARACTERISTIC,
      async (data) => {
        const dataType = getDataType(data);
        
        if (dataType === 'serialNumber') {
          console.log('시리얼 번호 수신:', data);
          onStatusUpdate('시리얼 번호 수신 - JWT 토큰 생성 중...');
          
          try {
            // 3. JWT 토큰 생성 (서버 통신 시뮬레이션)
            const jwtToken = await simulateServerRequest(data);
            
            onStatusUpdate('JWT 토큰 전송 중...');
            
            // 4. JWT 토큰 전송
            await writeData(device, BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, jwtToken);
            
            onStatusUpdate('IoT 기기 등록 완료!');
            onComplete({ serialNumber: data, jwtToken });
            
                     } catch (_error) {
             onError('JWT 토큰 처리 실패');
           }
        }
      },
      (error) => onError('데이터 모니터링 오류')
    );
    
  } catch (error) {
    onError('연결 코드 전송 실패');
    throw error;
  }
};

// 태블릿: IoT 등록 플로우 처리
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
          console.log('연결 코드 수신:', data);
          onStatusUpdate(`연결 코드 수신: ${data} - 시리얼 번호 전송 중...`);
          
          // 1초 후 시리얼 번호 응답
          setTimeout(async () => {
            try {
              await sendNotification(BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC, serialNumber);
              onStatusUpdate(`시리얼 번호 전송 완료: ${serialNumber} - JWT 대기 중...`);
                         } catch (_error) {
               onStatusUpdate('시리얼 번호 전송 실패');
             }
          }, 1000);
        }
        break;
        
      case 'jwtToken':
        console.log('JWT 토큰 수신:', data.substring(0, 50) + '...');
        onStatusUpdate('🎉 IoT 기기 등록 완료!');
        onComplete({ 
          connectionCode: '', // 이미 처리됨
          serialNumber, 
          jwtToken: data 
        });
        break;
        
      default:
        console.log('알 수 없는 데이터:', data);
        break;
    }
  } catch (_error) {
    console.error('데이터 처리 오류:', _error);
    onStatusUpdate('데이터 처리 실패');
  }
};

// 태블릿: Peripheral 모드 초기화
export const initializePeripheralMode = async (
  deviceName: string,
  onDataReceived: (deviceId: string, data: string) => void,
  onStatusUpdate: (status: string) => void
): Promise<() => void> => {
  try {
    onStatusUpdate('BLE 서비스 설정 중...');
    await setupPeripheralService(BLE_SERVICE_UUID, BLE_WRITE_CHARACTERISTIC);
    
    onStatusUpdate('데이터 리스너 설정 중...');
    const cleanupListener = setupDataListener(onDataReceived);
    
    onStatusUpdate('Advertising 시작 중...');
    await startAdvertising(deviceName);
    
    onStatusUpdate('연결 대기 중...');
    
    return cleanupListener;
  } catch (error) {
    onStatusUpdate('초기화 실패');
    throw error;
  }
};

// 정리
export const cleanup = (): void => {
  if (bleManagerInstance) {
    bleManagerInstance.destroy();
    bleManagerInstance = null;
  }
};