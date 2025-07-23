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

// BLE_WRITE_CHARACTERISTIC 별칭 제거 - 직접 BLE_CHARACTERISTICS.CODE_VERIFY 사용

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

// isIoTDevice 함수 제거 - 사용되지 않음

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

export const writeDataInChunks = async (
  device: Device,
  serviceUUID: string,
  characteristicUUID: string,
  message: string
): Promise<void> => {
  console.log('[writeDataInChunks] 청크 전송 시작:', { messageLength: message.length });
  
  // 메시지를 청크로 나누기
  const chunks: string[] = [];
  for (let i = 0; i < message.length; i += BLE_CHUNK_DATA_SIZE) {
    chunks.push(message.slice(i, i + BLE_CHUNK_DATA_SIZE));
  }
  
  console.log('[writeDataInChunks] 총 청크 수:', chunks.length);
  
  // 각 청크를 순차적으로 전송
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const base64Chunk = Buffer.from(chunk, 'utf-8').toString('base64');
    
    console.log(`[writeDataInChunks] 청크 ${i + 1}/${chunks.length} 전송:`, chunk.substring(0, 10) + '...');
    
    try {
      await device.writeCharacteristicWithResponseForService(
        serviceUUID,
        characteristicUUID,
        base64Chunk
      );
      
      // 청크 간 짧은 딜레이 (BLE 안정성을 위해)
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    } catch (error) {
      console.error(`[writeDataInChunks] 청크 ${i + 1} 전송 실패:`, error);
      throw error;
    }
  }
  
  console.log('[writeDataInChunks] 모든 청크 전송 완료');
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
  const BluetoothClientModule = NativeModules.BluetoothClient;
  
  if (!BluetoothClientModule) {
    console.error('[setupDataListener] BluetoothClientModule이 없습니다');
    return () => {};
  }
  
  let eventEmitter;
  try {
    eventEmitter = new NativeEventEmitter(BluetoothClientModule);
  } catch (error) {
    console.error('[setupDataListener] NativeEventEmitter 생성 실패:', error);
    return () => {};
  }
  
  const subscription = eventEmitter.addListener('onReceiveData', (event: any) => {
    try {
      let receivedString = '';
      if (event.data && Array.isArray(event.data)) {
        receivedString = String.fromCharCode(...event.data);
      } else if (typeof event.data === 'string') {
        receivedString = event.data;
      } else {
        console.error('[setupDataListener] 알 수 없는 데이터 형식:', event.data);
        return;
      }
      
      const deviceId = event.device || 'unknown';
      onDataReceived(deviceId, receivedString);
    } catch (error) {
      console.error('[setupDataListener] 데이터 수신 처리 오류:', error);
    }
  });
  
  return () => {
    try {
      subscription.remove();
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
  try {
    await BluetoothClient.sendNotificationToDevice(
      serviceUUID,
      characteristicUUID,
      message
    );
  } catch (error) {
    console.error('[sendNotification] 전송 실패, 연결 확인 중:', error);
    
    // 연결이 끊어진 경우를 체크하고 에러를 다시 던짐
    if (error instanceof Error && error.message.includes('연결')) {
      throw new Error('BLE 연결이 끊어졌습니다. 다시 연결해주세요.');
    }
    throw error;
  }
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
  
  let isCompleted = false; // 완료 상태 추적
  
  try {
    onStatusUpdate('연결 코드 전송 중...');
    console.log('[startIoTRegistration] 연결 코드 전송 시작');
    
    await writeData(device, BLE_SERVICE_UUID, BLE_CHARACTERISTICS.CODE_VERIFY, connectionCode);
    console.log('[startIoTRegistration] 연결 코드 전송 완료');
    onStatusUpdate('연결 코드 전송 완료 - 시리얼 번호 대기 중...');
    
    console.log('[startIoTRegistration] 모니터링 시작');
    const subscription = monitorCharacteristic(
      device,
      BLE_SERVICE_UUID,
      BLE_CHARACTERISTICS.CODE_VERIFY,
      async (data) => {
        if (isCompleted) return; // 이미 완료된 경우 무시
        
        const dataType = getDataType(data);
        console.log('[startIoTRegistration] 데이터 수신:', { data, dataType });
        
                  if (dataType === 'serialNumber') {
            onStatusUpdate('시리얼 번호 수신 - JWT 토큰 생성 중...');
            
            try {
              const jwtToken = await simulateServerRequest(data);
              onStatusUpdate('JWT 토큰 전송 중...');
              
              // START 마크와 함께 JWT 토큰 전송 시작
              const markedJwtToken = `START${jwtToken}END`;
              
              await writeDataInChunks(device, BLE_SERVICE_UUID, BLE_CHARACTERISTICS.CODE_VERIFY, markedJwtToken);
              
              // 완료 상태 설정 및 모니터링 중단
              isCompleted = true;
              subscription.remove();
              
              // JWT 토큰 전송 완료 후 안정화 시간 제공
              await new Promise(resolve => setTimeout(resolve, 500));
              onStatusUpdate('IoT 기기 등록 완료!');
              onComplete({ serialNumber: data, jwtToken });
            
          } catch (error) {
            console.error('[startIoTRegistration] JWT 토큰 처리 실패:', error);
            isCompleted = true;
            subscription.remove();
            
            if (error instanceof Error) {
              if (error.message.includes('timed out')) {
                onError('JWT 토큰 전송 타임아웃 - 재시도해주세요');
              } else if (error.message.includes('cancelled')) {
                onError('JWT 토큰 전송 취소됨');
              } else {
                onError(`JWT 토큰 처리 실패: ${error.message}`);
              }
            } else {
              onError('JWT 토큰 처리 실패');
            }
          }
        } else {
          console.log('[startIoTRegistration] 예상하지 못한 데이터 타입:', { data, dataType });
        }
      },
      (error) => {
        if (isCompleted) {
          console.log('[startIoTRegistration] 이미 완료된 상태 - 모니터링 에러 무시:', error);
          return;
        }
        console.error('[startIoTRegistration] 모니터링 오류:', error);
        onError('데이터 모니터링 오류');
      }
    );
    
    return subscription;
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
  onComplete: (result: { connectionCode: string; serialNumber: string; jwtToken: string }) => void,
  onConnectionCodeReceived?: (connectionCode: string, onConfirm: () => Promise<void>) => void
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
          
          onStatusUpdate(`연결 코드 수신: ${data}`);
          console.log('[handleIoTRegistrationData] 유효한 연결 코드 수신:', data);
          
                    // 사용자 확인 콜백이 있으면 팝업을 띄우고 확인 대기
          if (onConnectionCodeReceived) {
            console.log('[handleIoTRegistrationData] 사용자 확인 요청');
            
            const sendSerialNumber = async () => {
              onStatusUpdate(`연결 승인됨 - 시리얼 번호 전송 중...`);
              
              try {
                await sendNotification(BLE_SERVICE_UUID, BLE_CHARACTERISTICS.CODE_VERIFY, serialNumber);
                onStatusUpdate(`시리얼 번호 전송 완료: ${serialNumber} - JWT 대기 중...`);
              } catch (error) {
                console.error('[handleIoTRegistrationData] 시리얼 번호 전송 실패:', error);
                onStatusUpdate('시리얼 번호 전송 실패');
              }
            };
            
            onConnectionCodeReceived(data, sendSerialNumber);
          } else {
            // 기존 동작 (즉시 시리얼 번호 전송)
            onStatusUpdate(`연결 코드 수신: ${data} - 시리얼 번호 전송 중...`);
            console.log('[handleIoTRegistrationData] 유효한 연결 코드 수신, 시리얼 번호 전송 시작');
            
            // 즉시 시리얼 번호 전송 시도
            try {
              await sendNotification(BLE_SERVICE_UUID, BLE_CHARACTERISTICS.CODE_VERIFY, serialNumber);
              onStatusUpdate(`시리얼 번호 전송 완료: ${serialNumber} - JWT 대기 중...`);
            } catch (error) {
              console.error('[handleIoTRegistrationData] 시리얼 번호 전송 실패:', error);
              onStatusUpdate('시리얼 번호 전송 실패');
            }
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
  await setupPeripheralService(BLE_SERVICE_UUID, BLE_CHARACTERISTICS.CODE_VERIFY);
  
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