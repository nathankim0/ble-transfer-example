import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Device, Subscription } from 'react-native-ble-plx';
import {
  requestPermissions,
  scanForDevices,
  stopScan,
  connectToDevice,
  disconnectDevice,
  startIoTRegistration,
  cleanup,
} from '../utils/bleManager';
import {
  generateConnectionCode,
  isIoTDevice,
} from '../utils/bleUtils';

interface DeviceInfo {
  id: string;
  name: string;
  rssi?: number;
  device: Device;
}

const MobileScreen: React.FC = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Map<string, DeviceInfo>>(new Map());
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [connectionCode] = useState(generateConnectionCode());
  const [status, setStatus] = useState('준비');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const registrationSubscription = useRef<Subscription | null>(null);
  const connectedDeviceRef = useRef<Device | null>(null);

  useEffect(() => {
    connectedDeviceRef.current = connectedDevice;
  }, [connectedDevice]);

  useEffect(() => {
    initializeBLE();
    
    return () => {
      console.log('[MobileScreen] Cleaning up...');
      if (registrationSubscription.current) {
        registrationSubscription.current.remove();
      }
      if (connectedDeviceRef.current) {
        disconnectDevice(connectedDeviceRef.current).catch(() => {});
      }
      cleanup();
    };
  }, []);

  const initializeBLE = async () => {
    try {
      const hasPermissions = await requestPermissions();
      if (!hasPermissions) {
        Alert.alert('권한 필요', 'Bluetooth 사용을 위해 필요한 권한을 허용해주세요.');
        return;
      }
      setStatus('권한 확인 완료');
    } catch (error) {
      console.error('BLE 초기화 오류:', error);
      Alert.alert('오류', 'Bluetooth를 초기화할 수 없습니다.');
    }
  };

  const startScan = async () => {
    if (isScanning) return;
    
    setDevices(new Map());
    setIsScanning(true);
    setStatus('스캔 중...');
    
    try {
      scanForDevices(
        (device) => {
          if (isIoTDevice(device.name)) {
            setDevices(prev => {
              const deviceInfo: DeviceInfo = {
                id: device.id,
                name: device.name || 'Unknown Device',
                rssi: device.rssi || undefined,
                device: device,
              };
              return new Map(prev.set(device.id, deviceInfo));
            });
          }
        },
        (error) => {
          console.error('스캔 에러:', error);
          setIsScanning(false);
          setStatus('스캔 오류');
        }
      );
      
      setTimeout(() => {
        if (isScanning) {
          handleStopScan();
        }
      }, 10000);
      
    } catch (error) {
      console.error('스캔 시작 오류:', error);
      setIsScanning(false);
      Alert.alert('오류', 'BLE 스캔을 시작할 수 없습니다.');
    }
  };

  const handleStopScan = () => {
    stopScan();
    setIsScanning(false);
    setStatus(devices.size > 0 ? `${devices.size}개 기기 발견` : '기기를 찾을 수 없음');
  };

  const handleConnectDevice = async (deviceInfo: DeviceInfo) => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    setStatus('연결 중...');
    
    try {
      const device = await connectToDevice(deviceInfo.id);
      setConnectedDevice(device);
      setStatus('연결됨');
      
      Alert.alert('연결 성공', '기기에 연결되었습니다. IoT 등록을 시작하시겠습니까?', [
        { text: '취소', style: 'cancel' },
        { text: '시작', onPress: () => startRegistration(device) }
      ]);
      
    } catch (error) {
      console.error('연결 오류:', error);
      Alert.alert('오류', '기기 연결에 실패했습니다.');
      setStatus('연결 실패');
    } finally {
      setIsProcessing(false);
    }
  };

  const startRegistration = async (device: Device) => {
    try {
      registrationSubscription.current = await startIoTRegistration(
        device,
        connectionCode,
        (status) => setStatus(status),
        (result) => {
          Alert.alert('성공', `IoT 기기 등록이 완료되었습니다!\n\n시리얼 번호: ${result.serialNumber}\nJWT: ${result.jwtToken.substring(0, 50)}...`, [
            {
              text: '확인',
              onPress: () => setStatus('등록 완료')
            }
          ]);
        },
        (error) => {
          Alert.alert('오류', error);
          setStatus('등록 실패');
        }
      );
    } catch (error) {
      console.error('등록 시작 오류:', error);
      Alert.alert('오류', 'IoT 등록을 시작할 수 없습니다.');
    }
  };

  const handleDisconnect = async () => {
    if (!connectedDevice) return;
    
    try {
      if (registrationSubscription.current) {
        registrationSubscription.current.remove();
        registrationSubscription.current = null;
      }
      
      await disconnectDevice(connectedDevice);
      setConnectedDevice(null);
      setStatus('연결 해제됨');
      
    } catch (error) {
      console.error('연결 해제 오류:', error);
    }
  };

  const renderDevice = ({ item }: { item: DeviceInfo }) => (
    <TouchableOpacity
      style={[
        styles.deviceItem,
        connectedDevice?.id === item.id && styles.connectedDevice
      ]}
      onPress={() => handleConnectDevice(item)}
      disabled={isProcessing || !!connectedDevice}
    >
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{item.name}</Text>
        <Text style={styles.deviceId}>ID: {item.id.slice(-8)}</Text>
        {item.rssi && (
          <Text style={styles.deviceRssi}>신호: {item.rssi} dBm</Text>
        )}
      </View>
      <Text style={styles.connectButton}>
        {connectedDevice?.id === item.id ? '연결됨' : '연결'}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>모바일 - IoT 기기 등록</Text>
      
      <View style={styles.infoContainer}>
        <Text style={styles.infoLabel}>전송할 연결 코드:</Text>
        <Text style={styles.connectionCode}>{connectionCode}</Text>
      </View>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.scanButton, isScanning && styles.scanButtonActive]}
          onPress={isScanning ? handleStopScan : startScan}
          disabled={isProcessing}
        >
          <Text style={styles.scanButtonText}>
            {isScanning ? '스캔 중지' : 'IoT 기기 스캔'}
          </Text>
        </TouchableOpacity>
        
        {connectedDevice && (
          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={handleDisconnect}
          >
            <Text style={styles.disconnectButtonText}>연결 해제</Text>
          </TouchableOpacity>
        )}
      </View>
      
      <View style={styles.statusContainer}>
        <Text style={styles.statusLabel}>상태: </Text>
        <Text style={styles.statusText}>{status}</Text>
      </View>
      
      {isProcessing && (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
      )}
      
      <Text style={styles.deviceListTitle}>
        발견된 IoT 기기 ({devices.size})
      </Text>
      
      <FlatList
        data={Array.from(devices.values())}
        renderItem={renderDevice}
        keyExtractor={item => item.id}
        style={styles.deviceList}
        contentContainerStyle={styles.deviceListContainer}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {isScanning ? '스캔 중...' : '기기를 찾을 수 없습니다. 스캔 버튼을 눌러주세요.'}
          </Text>
        }
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
  infoContainer: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976d2',
    marginBottom: 8,
  },
  connectionCode: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1976d2',
    letterSpacing: 4,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  scanButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  scanButtonActive: {
    backgroundColor: '#dc3545',
  },
  scanButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  disconnectButton: {
    flex: 1,
    backgroundColor: '#6c757d',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  disconnectButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
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
  loader: {
    marginBottom: 20,
  },
  deviceListTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
  },
  deviceList: {
    flex: 1,
  },
  deviceListContainer: {
    gap: 10,
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
  connectedDevice: {
    backgroundColor: '#4CAF50',
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
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 20,
    fontStyle: 'italic',
  },
});

export default MobileScreen;