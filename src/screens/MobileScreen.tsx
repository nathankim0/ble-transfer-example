import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { BleManager, Device, State, Subscription, BleError } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import {
  BLE_SERVICE_UUID,
  BLE_CHARACTERISTICS,
  RETRY_ATTEMPTS,
} from '../constants/bleConstants';
import { stringToBytes, chunkData, bytesToString, generateConnectionCode } from '../utils/bleUtils';
import { peripheralMode } from '../utils/bleManager';

const generateJwtToken = (serialNumber: string): string => {
  // 실제로는 서버에서 생성해야 하지만, 테스트를 위해 모킹
  const mockPayload = {
    deviceId: serialNumber,
    userId: 'user123',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
  };
  
  // Mock JWT format
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify(mockPayload));
  const signature = 'mock-signature-' + serialNumber.replace(/-/g, '');
  
  return `${header}.${payload}.${signature}`;
};
const SECONDS_TO_SCAN_FOR = 10;

interface DeviceWithStatus {
  id: string;
  name: string | null;
  rssi?: number;
  connected?: boolean;
  connecting?: boolean;
  rawDevice: Device;
}

const MobileScreen: React.FC = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState(new Map<string, DeviceWithStatus>());
  const [connectionCode] = useState(generateConnectionCode()); // 자동 생성된 코드
  const [status, setStatus] = useState('준비');
  const [isProcessing, setIsProcessing] = useState(false);
  const [receivedSerialNumber, setReceivedSerialNumber] = useState<string | null>(null);
  const [tokenSent, setTokenSent] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [showAllDevices, setShowAllDevices] = useState(false); // 테스트 모드
  const [isPeripheralMode, setIsPeripheralMode] = useState(false);
  
  const bleManager = useRef<BleManager>(new BleManager()).current;
  const scanTimer = useRef<NodeJS.Timeout | null>(null);
  const retryCount = useRef(0);
  const scanSubscription = useRef<Subscription | null>(null);
  const monitorSubscription = useRef<Subscription | null>(null);
  const cleanupPeripheral = useRef<(() => void) | null>(null);

  useEffect(() => {
    const currentScanSubscription = scanSubscription.current;
    const currentMonitorSubscription = monitorSubscription.current;
    const currentBleManager = bleManager;
    
    initializeBLE();
    
    return () => {
      console.debug('[MobileScreen] Cleaning up...');
      if (currentScanSubscription) {
        currentScanSubscription.remove();
      }
      if (currentMonitorSubscription) {
        currentMonitorSubscription.remove();
      }
      if (scanTimer.current) {
        clearTimeout(scanTimer.current);
      }
      if (connectedDevice) {
        connectedDevice.cancelConnection().catch(() => {});
      }
      if (cleanupPeripheral.current) {
        cleanupPeripheral.current();
      }
      if (isPeripheralMode) {
        peripheralMode.stopAdvertising().catch(() => {});
      }
      currentBleManager.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializeBLE = async () => {
    try {
      const state = await bleManager.state();
      console.debug('BLE State:', state);
      
      if (state === State.PoweredOff) {
        Alert.alert('Bluetooth 꺼짐', 'Bluetooth를 켜주세요.');
        return;
      }
      
      if (Platform.OS === 'android') {
        await handleAndroidPermissions();
      }
      
      console.debug('BLE Manager initialized.');
    } catch (error) {
      console.error('BLE 초기화 오류:', error);
      Alert.alert('오류', 'Bluetooth를 초기화할 수 없습니다.');
    }
  };

  const handleAndroidPermissions = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 31) {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];
      
      const results = await PermissionsAndroid.requestMultiple(permissions);
      const allGranted = Object.values(results).every(
        result => result === PermissionsAndroid.RESULTS.GRANTED
      );
      
      if (!allGranted) {
        Alert.alert('권한 필요', 'BLE 기능을 사용하려면 모든 권한이 필요합니다.');
      }
    } else if (Platform.OS === 'android' && Platform.Version >= 23) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('권한 필요', 'BLE 기능을 사용하려면 위치 권한이 필요합니다.');
      }
    }
  };

  const startScan = async () => {
    if (isScanning) return;
    
    if (scanTimer.current) {
      clearTimeout(scanTimer.current);
      scanTimer.current = null;
    }
    
    setDevices(new Map());
    setIsScanning(true);
    setStatus('스캔 중...');
    
    try {
      console.debug('[startScan] starting scan for all devices...');
      
      // 모든 기기 스캔 후 필터링
      await bleManager.startDeviceScan(null, { allowDuplicates: false }, (error: BleError | null, device: Device | null) => {
        if (error) {
          console.error('[startScan] scan error:', error);
          stopScan();
          return;
        }
        
        if (device) {
          // 테스트 모드면 모든 기기 표시, 아니면 필터링
          if (showAllDevices || isIoTDevice(device)) {
            handleDiscoverDevice(device);
          } else {
            // 디버깅: 필터링된 기기 로그 출력
            console.debug(`[startScan] filtered out: ${device.name || device.localName || 'Unknown'} (${device.id.slice(-6)})`);
          }
        }
      });
      
      scanTimer.current = setTimeout(() => {
        stopScan();
      }, SECONDS_TO_SCAN_FOR * 1000);
    } catch (error) {
      console.error('[startScan] ble scan error:', error);
      setIsScanning(false);
      Alert.alert('오류', 'BLE 스캔을 시작할 수 없습니다.');
    }
  };

  const stopScan = async () => {
    if (scanTimer.current) {
      clearTimeout(scanTimer.current);
      scanTimer.current = null;
    }
    
    try {
      await bleManager.stopDeviceScan();
      setIsScanning(false);
      setStatus('스캔 중지됨');
      console.debug('[stopScan] scan stopped');
    } catch (error) {
      console.error('[stopScan] error:', error);
      setIsScanning(false);
    }
  };

  const handleDiscoverDevice = (device: Device) => {
    console.debug('[handleDiscoverDevice] new BLE device=', device.name, device.id, 'localName=', device.localName);
    
    setDevices(map => {
      // 더 나은 기기 이름 생성
      let deviceName = device.name || device.localName;
      if (!deviceName) {
        // MAC 주소의 마지막 3바이트를 사용하여 식별 가능한 이름 생성
        const shortId = device.id.split('-').pop()?.slice(-6).toUpperCase() || device.id.slice(-6);
        deviceName = `BLE-${shortId}`;
      }
      
      const deviceWithStatus: DeviceWithStatus = {
        id: device.id,
        name: deviceName,
        rssi: device.rssi || undefined,
        connected: false,
        connecting: false,
        rawDevice: device,
      };
      return new Map(map.set(device.id, deviceWithStatus));
    });
  };

  const connectToDevice = async (device: DeviceWithStatus) => {
    setIsProcessing(true);
    setStatus('연결 중...');
    retryCount.current = 0;
    
    try {
      await connectDevice(device);
    } catch (error) {
      console.error('연결 오류:', error);
      Alert.alert('오류', '기기 연결에 실패했습니다.');
      setIsProcessing(false);
      setStatus('연결 실패');
    }
  };

  const connectDevice = async (device: DeviceWithStatus) => {
    try {
      setDevices(map => {
        const d = map.get(device.id);
        if (d) {
          d.connecting = true;
          return new Map(map.set(d.id, d));
        }
        return map;
      });

      const connectedDevice = await device.rawDevice.connect();
      console.debug(`[connectDevice][${device.id}] connected.`);
      
      setConnectedDevice(connectedDevice);
      
      setDevices(map => {
        const d = map.get(device.id);
        if (d) {
          d.connecting = false;
          d.connected = true;
          return new Map(map.set(d.id, d));
        }
        return map;
      });

      await sleep(900);

      const servicesAndCharacteristics = await connectedDevice.discoverAllServicesAndCharacteristics();
      console.debug(`[connectDevice][${device.id}] discovered services and characteristics`);

      try {
        const rssiValue = await connectedDevice.readRSSI();
        console.debug(`[connectDevice][${device.id}] RSSI: ${rssiValue} dBm`);
        
        setDevices(map => {
          const d = map.get(device.id);
          if (d) {
            d.rssi = typeof rssiValue === 'number' ? rssiValue : device.rawDevice.rssi || undefined;
            return new Map(map.set(d.id, d));
          }
          return map;
        });
      } catch (error) {
        console.debug(`[connectDevice][${device.id}] Could not read RSSI: ${error}`);
      }

      setStatus('연결됨');

      const services = await servicesAndCharacteristics.services();
      const hasOurService = services.some(
        service => service.uuid.toUpperCase() === BLE_SERVICE_UUID.toUpperCase()
      );

      if (hasOurService) {
        // 먼저 모니터링 설정
        console.log('[MobileScreen] Setting up characteristic monitoring...');
        monitorSubscription.current = connectedDevice.monitorCharacteristicForService(
          BLE_SERVICE_UUID,
          BLE_CHARACTERISTICS.STATUS,
          (error, characteristic) => {
            if (error) {
              console.error('[MobileScreen] Monitor error:', error);
              return;
            }
            
            if (characteristic?.value) {
              const receivedMessage = bytesToString(Array.from(Buffer.from(characteristic.value, 'base64')));
              console.log('[MobileScreen] Received message from tablet:', receivedMessage);
              
              // 시리얼 번호 수신
              if (receivedMessage.startsWith('TAB-') || receivedMessage.includes('-')) {
                console.log('[MobileScreen] Serial number received via monitoring:', receivedMessage);
                
                // 이미 수신한 시리얼 번호와 동일한지 확인
                if (receivedSerialNumber === receivedMessage) {
                  console.log('[MobileScreen] Duplicate serial number received, ignoring');
                  return;
                }
                
                setReceivedSerialNumber(receivedMessage);
                setStatus(`시리얼 번호 수신: ${receivedMessage}`);
                
                // peripheral 모드 종료 (이미 수신했으므로)
                if (isPeripheralMode) {
                  console.log('[MobileScreen] Stopping peripheral mode after receiving serial');
                  peripheralMode.stopAdvertising().catch(err => 
                    console.error('[MobileScreen] Error stopping advertising:', err)
                  );
                  if (cleanupPeripheral.current) {
                    cleanupPeripheral.current();
                    cleanupPeripheral.current = null;
                  }
                  setIsPeripheralMode(false);
                }
                
                // 시리얼 번호를 기반으로 JWT 토큰 생성 및 전송
                setTimeout(() => {
                  console.log('[MobileScreen] Generating JWT token for serial:', receivedMessage);
                  sendJwtToken(receivedMessage, connectedDevice);
                }, 500);
              } else {
                // 기타 데이터
                console.log('[MobileScreen] Other data received:', receivedMessage);
                setStatus(`데이터 수신: ${receivedMessage}`);
              }
            }
          }
        );
        
        // STATUS characteristic 모니터링은 이미 위에서 설정했으므로 제거

        // 모니터링 설정 후 연결 코드 전송
        console.log('[MobileScreen] Sending connection code to tablet...');
        await verifyConnectionCode(connectedDevice);
        
        // 모바일도 일시적으로 peripheral 모드로 전환하여 태블릿의 연결을 받을 준비
        console.log('[MobileScreen] Setting up temporary peripheral mode to receive serial number...');
        
        try {
          // Peripheral 서비스 설정
          await peripheralMode.setupService();
          
          // 데이터 수신 리스너 설정
          cleanupPeripheral.current = peripheralMode.setupDataListener((deviceId, data) => {
            console.log('[MobileScreen] Received data in peripheral mode:', data, 'from:', deviceId);
            
            if (data.startsWith('TAB-') || data.includes('-')) {
              console.log('[MobileScreen] Serial number received via peripheral:', data);
              
              // 이미 수신한 시리얼 번호와 동일한지 확인
              if (receivedSerialNumber === data) {
                console.log('[MobileScreen] Duplicate serial number received in peripheral mode, ignoring');
                return;
              }
              
              setReceivedSerialNumber(data);
              setStatus(`시리얼 번호 수신: ${data}`);
              
              // Peripheral 모드 종료
              peripheralMode.stopAdvertising().catch(err => 
                console.error('[MobileScreen] Error stopping advertising:', err)
              );
              if (cleanupPeripheral.current) {
                cleanupPeripheral.current();
                cleanupPeripheral.current = null;
              }
              setIsPeripheralMode(false);
              
              // JWT 토큰 생성 및 전송
              setTimeout(() => {
                console.log('[MobileScreen] Generating JWT token for serial:', data);
                sendJwtToken(data, connectedDevice);
              }, 500);
            }
          });
          
          // Advertising 시작 (10초간)
          const advertisingName = `Mobile-${connectionCode}`;
          console.log('[MobileScreen] Starting peripheral mode with name:', advertisingName);
          await peripheralMode.startAdvertising(advertisingName);
          setIsPeripheralMode(true);
          setStatus('시리얼 번호 대기 중...');
          console.log('[MobileScreen] Peripheral mode started successfully');
          
          // 15초 후 자동으로 peripheral 모드 종료 (태블릿의 재시도 시간 고려)
          setTimeout(async () => {
            if (isPeripheralMode && !receivedSerialNumber) {
              console.log('[MobileScreen] Timeout waiting for serial number');
              await peripheralMode.stopAdvertising();
              if (cleanupPeripheral.current) {
                cleanupPeripheral.current();
                cleanupPeripheral.current = null;
              }
              setIsPeripheralMode(false);
              setStatus('시리얼 번호 수신 시간 초과');
            }
          }, 15000);
          
        } catch (error) {
          console.error('[MobileScreen] Failed to setup peripheral mode:', error);
          setStatus('시리얼 번호 수신 준비 실패');
        }
      } else {
        Alert.alert('알림', '이 기기는 우리의 IoT 기기가 아닙니다.');
        await connectedDevice.cancelConnection();
        setIsProcessing(false);
      }
    } catch (error) {
      console.error(`[connectDevice][${device.id}] connectDevice error`, error);
      
      if (retryCount.current < RETRY_ATTEMPTS) {
        retryCount.current++;
        setStatus(`재시도 중... (${retryCount.current}/${RETRY_ATTEMPTS})`);
        await sleep(1000);
        return connectDevice(device);
      }
      
      throw error;
    }
  };

  const verifyConnectionCode = async (device: Device) => {
    try {
      setStatus('연결 코드 전송 중...');
      const codeBytes = stringToBytes(connectionCode);
      const base64Data = Buffer.from(codeBytes).toString('base64');
      
      console.log('[MobileScreen] Sending connection code:', connectionCode);
      
      await device.writeCharacteristicWithResponseForService(
        BLE_SERVICE_UUID,
        BLE_CHARACTERISTICS.CODE_VERIFY,
        base64Data
      );
      
      console.log('[MobileScreen] Connection code sent successfully');
      setStatus('연결 코드 전송 완료 - JWT 요청 대기 중...');
    } catch (error) {
      console.error('[MobileScreen] Code verification error:', error);
      throw error;
    }
  };

  const sendJwtToken = async (serialNumber?: string, device?: Device) => {
    const targetDevice = device || connectedDevice;
    if (!targetDevice) {
      console.error('[MobileScreen] No connected device for JWT token');
      return;
    }
    
    if (tokenSent) {
      console.log('[MobileScreen] JWT token already sent');
      return;
    }
    
    try {
      const jwtToken = generateJwtToken(serialNumber || receivedSerialNumber || 'UNKNOWN');
      console.log('[MobileScreen] Generated JWT token for serial', serialNumber || receivedSerialNumber);
      console.log('[MobileScreen] Token preview:', jwtToken.substring(0, 50) + '...');
      
      const chunks = chunkData(jwtToken);
      setStatus(`JWT 토큰 자동 전송 중... (0/${chunks.length})`);
      
      for (let i = 0; i < chunks.length; i++) {
        const chunkBytes = stringToBytes(chunks[i]);
        const base64Data = Buffer.from(chunkBytes).toString('base64');
        console.log(`[MobileScreen] Sending JWT chunk ${i + 1}/${chunks.length}`);
        
        await targetDevice.writeCharacteristicWithResponseForService(
          BLE_SERVICE_UUID,
          BLE_CHARACTERISTICS.JWT_TOKEN,
          base64Data
        );
        
        setStatus(`JWT 토큰 자동 전송 중... (${i + 1}/${chunks.length})`);
        await sleep(50); // 더 빠르게 전송
      }
      
      setTokenSent(true);
      setStatus('JWT 토큰 전송 완료!');
      console.log('[MobileScreen] JWT token sent successfully');
      
      Alert.alert('성공', 'IoT 기기 등록이 완료되었습니다!\n\nJWT 토큰이 자동으로 전송되었습니다.', [
        {
          text: '확인',
          onPress: () => {
            if (targetDevice) {
              targetDevice.cancelConnection();
            }
            resetState();
          },
        },
      ]);
    } catch (error) {
      console.error('[MobileScreen] JWT token send error:', error);
      Alert.alert('오류', 'JWT 토큰 전송에 실패했습니다.');
      setStatus('JWT 토큰 전송 실패');
    }
  };

  const toggleDeviceConnection = async (device: DeviceWithStatus) => {
    if (device && device.connected) {
      try {
        if (connectedDevice) {
          await connectedDevice.cancelConnection();
          setConnectedDevice(null);
        }
      } catch (error) {
        console.error(`[toggleDeviceConnection][${device.id}] error when trying to disconnect`, error);
      }
    } else {
      await connectToDevice(device);
    }
  };

  const resetState = () => {
    setConnectedDevice(null);
    setDevices(new Map());
    setIsProcessing(false);
    setStatus('준비');
    setReceivedSerialNumber(null);
    setTokenSent(false);
  };

  const sleep = (ms: number) => {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  };

  const isIoTDevice = (device: Device): boolean => {
    // 일단 테스트를 위해 필터링 완화
    const deviceName = device.name || device.localName || '';
    
    // 1. 확실한 IoT 패턴
    const iotPatterns = [
      'IoT-',
      'AlgoCare-',
      'Tablet-',
      'TAB-',
      'ALGO-'
    ];
    
    const hasIoTName = iotPatterns.some(pattern => 
      deviceName.toUpperCase().includes(pattern.toUpperCase())
    );
    
    // 2. 일반적인 태블릿/기기 패턴도 포함
    const commonPatterns = [
      'iPad',
      'Galaxy Tab',
      'SM-',  // Samsung
      'BLE-', // 우리가 만든 기기명
    ];
    
    const hasCommonName = commonPatterns.some(pattern => 
      deviceName.toUpperCase().includes(pattern.toUpperCase())
    );
    
    // 3. 이름이 있고 RSSI가 적당한 기기
    const hasReasonableName = deviceName.length > 0;
    const hasGoodSignal = !device.rssi || device.rssi > -90; // 더 관대하게
    
    const isValid = (hasIoTName || hasCommonName || hasReasonableName) && hasGoodSignal;
    
    console.debug(`[isIoTDevice] ${deviceName} (${device.id.slice(-6)}): iot=${hasIoTName}, common=${hasCommonName}, named=${hasReasonableName}, signal=${hasGoodSignal}, rssi=${device.rssi} -> ${isValid}`);
    
    return isValid;
  };

  const renderDevice = ({ item }: { item: DeviceWithStatus }) => {
    const backgroundColor = item.connected ? '#4CAF50' : 'white';
    
    return (
      <TouchableOpacity
        style={[styles.deviceItem, { backgroundColor }]}
        onPress={() => toggleDeviceConnection(item)}
        disabled={isProcessing && !item.connected}
      >
        <View style={styles.deviceInfo}>
          <Text style={[styles.deviceName, item.connected && styles.connectedText]}>
            {item.name}
            {item.connecting && ' - 연결 중...'}
          </Text>
          <Text style={[styles.deviceId, item.connected && styles.connectedText]}>
            {item.id}
          </Text>
          {item.rssi !== undefined && (
            <Text style={[styles.deviceRssi, item.connected && styles.connectedText]}>
              신호 강도: {item.rssi} dBm
            </Text>
          )}
        </View>
        <Text style={[styles.connectButton, item.connected && styles.connectedText]}>
          {item.connected ? '연결됨' : '연결'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <>
      <Text style={styles.title}>IoT 기기 등록</Text>
      
      <View style={styles.tokenInfoContainer}>
        <Text style={styles.tokenInfoLabel}>전송할 JWT 토큰:</Text>
        <View style={styles.tokenPreviewBox}>
          <Text style={styles.tokenPreview}>
            시리얼 번호를 수신하면 자동 생성됩니다
          </Text>
        </View>
      </View>
      
      <View style={styles.codeInputContainer}>
        <Text style={styles.label}>내 연결 코드 (태블릿으로 전송됨)</Text>
        <View style={styles.codeDisplay}>
          <Text style={styles.codeDisplayText}>{connectionCode}</Text>
        </View>
      </View>
      
      <TouchableOpacity
        style={[styles.scanButton, isScanning && styles.scanButtonActive]}
        onPress={isScanning ? stopScan : startScan}
        disabled={isProcessing}
      >
        <Text style={styles.scanButtonText}>
          {isScanning ? '스캔 중지' : '주변 기기 스캔'}
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.filterButton, showAllDevices && styles.filterButtonActive]}
        onPress={() => setShowAllDevices(!showAllDevices)}
        disabled={isProcessing}
      >
        <Text style={styles.filterButtonText}>
          {showAllDevices ? '🔍 모든 기기 표시 중' : '🎯 IoT 기기만 표시'}
        </Text>
      </TouchableOpacity>
      
      <View style={styles.statusContainer}>
        <Text style={styles.statusLabel}>상태: </Text>
        <Text style={styles.statusText}>{status}</Text>
      </View>
      
      {isPeripheralMode && (
        <View style={styles.peripheralModeIndicator}>
          <Text style={styles.peripheralModeText}>📡 시리얼 번호 수신 대기 중...</Text>
        </View>
      )}
      
      {receivedSerialNumber && (
        <View style={styles.serialContainer}>
          <Text style={styles.serialLabel}>수신된 시리얼 번호:</Text>
          <Text style={styles.serialNumber}>{receivedSerialNumber}</Text>
          <Text style={styles.jwtGeneratedText}>
            ✅ 이 시리얼 번호로 JWT 토큰을 생성했습니다
          </Text>
        </View>
      )}
      
      {isProcessing && (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
      )}
      
      <Text style={styles.deviceListTitle}>
        {showAllDevices ? `발견된 모든 기기 (${devices.size})` : `발견된 IoT 기기 (${devices.size})`}
      </Text>
      
      {devices.size === 0 && !isScanning && (
        <View style={styles.noDevicesContainer}>
          <Text style={styles.noDevicesTitle}>
            {showAllDevices ? '기기를 찾을 수 없습니다' : 'IoT 기기를 찾을 수 없습니다'}
          </Text>
          <Text style={styles.noDevicesText}>
            {showAllDevices ? 
              '• Bluetooth가 켜져있는지 확인하세요\n• 주변에 BLE 기기가 있는지 확인하세요\n• 위의 필터 버튼을 눌러 "IoT 기기만 표시"로 변경해보세요' :
              '• IoT 기기의 Bluetooth가 켜져있는지 확인하세요\n• 기기 이름이 \'IoT-\', \'AlgoCare-\', \'Tablet-\' 등으로 시작하는지 확인하세요\n• 기기가 가까이 있는지 확인하세요 (신호강도 -90dBm 이상)\n• 위의 필터 버튼을 눌러 "모든 기기 표시"로 변경해보세요'
            }
          </Text>
        </View>
      )}
    </>
  );

  const renderEmpty = () => null; // noDevicesContainer에서 이미 처리

  return (
    <View style={styles.container}>
      <FlatList
        data={Array.from(devices.values())}
        renderItem={renderDevice}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.flatListContent}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
    textAlign: 'center',
  },
  tokenInfoContainer: {
    backgroundColor: '#e8f5e9',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  tokenInfoLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  tokenPreviewBox: {
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  tokenPreview: {
    fontSize: 12,
    color: '#333',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  codeInputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    marginBottom: 8,
    color: '#666',
  },
  codeInput: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    fontSize: 20,
    letterSpacing: 2,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  codeDisplay: {
    backgroundColor: '#e3f2fd',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1976d2',
  },
  codeDisplayText: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 4,
    color: '#1976d2',
  },
  scanButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20,
  },
  scanButtonActive: {
    backgroundColor: '#dc3545',
  },
  scanButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  filterButton: {
    backgroundColor: '#6c757d',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  filterButtonActive: {
    backgroundColor: '#28a745',
  },
  filterButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statusLabel: {
    fontSize: 16,
    color: '#666',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  serialContainer: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  serialLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  serialNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976d2',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  loader: {
    marginBottom: 20,
  },
  deviceList: {
    flex: 1,
    minHeight: 200,
  },
  deviceListTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
  },
  deviceItem: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  deviceId: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  deviceRssi: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  connectButton: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  connectedText: {
    color: 'white',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 20,
  },
  flatListContent: {
    gap: 10,
    paddingBottom: 20,
  },
  noDevicesContainer: {
    backgroundColor: '#fff3e0',
    padding: 20,
    borderRadius: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ffb74d',
  },
  noDevicesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e65100',
    marginBottom: 10,
    textAlign: 'center',
  },
  noDevicesText: {
    fontSize: 14,
    color: '#bf360c',
    lineHeight: 20,
  },
  jwtGeneratedText: {
    fontSize: 12,
    color: '#388e3c',
    marginTop: 8,
    fontStyle: 'italic',
  },
  peripheralModeIndicator: {
    backgroundColor: '#fff3e0',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  peripheralModeText: {
    fontSize: 14,
    color: '#e65100',
    fontWeight: '500',
  },
});

export default MobileScreen;