import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import {
  requestPermissions,
  checkBluetoothClient,
  initializePeripheralMode,
  handleIoTRegistrationData,
  stopAdvertising,
  generateSerialNumber,
} from '../utils/bleManager';

const TabletScreen: React.FC = () => {
  const [deviceName] = useState(`IoT-TAB-${Date.now().toString().slice(-6)}`);
  const [serialNumber] = useState(generateSerialNumber());
  const [status, setStatus] = useState('초기화 중...');
  const [isAdvertising, setIsAdvertising] = useState(false);
  const [connectionCode, setConnectionCode] = useState<string | null>(null);
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [connectedDevices, setConnectedDevices] = useState<string[]>([]);
  
    const cleanupListener = useRef<(() => void) | null>(null);

  const onDataReceived = useCallback(async (deviceId: string, data: string) => {
    console.log('[TabletScreen] 데이터 수신:', { deviceId, data, length: data.length });
    
    try {
      // connectedDevices state를 직접 참조하지 않고 setter 함수만 사용
      setConnectedDevices(prev => {
        if (!prev.includes(deviceId)) {
          console.log('[TabletScreen] 새로운 기기 연결:', deviceId);
          return [...prev, deviceId];
        }
        return prev;
      });
      
      console.log('[TabletScreen] handleIoTRegistrationData 호출 전');
      await handleIoTRegistrationData(
        deviceId,
        data,
        serialNumber,
        (status) => {
          console.log('[TabletScreen] 상태 업데이트:', status);
          setStatus(status);
        },
        (result) => {
          console.log('[TabletScreen] 등록 완료:', result);
          if (result.connectionCode) {
            setConnectionCode(result.connectionCode);
          }
          if (result.jwtToken) {
            setJwtToken(result.jwtToken);
            Alert.alert(
              '✅ 등록 완료!',
              `IoT 기기가 성공적으로 등록되었습니다!\n\n연결 코드: ${result.connectionCode}\n시리얼 번호: ${result.serialNumber}\n\nJWT 토큰:\n${result.jwtToken}`,
              [
                {
                  text: '확인',
                  onPress: () => console.log('[TabletScreen] 등록 프로세스 완료')
                }
              ]
            );
          }
        },
        (connectionCode, onConfirm) => {
          console.log('[TabletScreen] 연결 코드 확인 요청:', connectionCode);
          
          let timeoutId: NodeJS.Timeout;
          let alertShown = false;
          
          // 30초 후 자동 취소 (BLE 타임아웃 전에)
          timeoutId = setTimeout(() => {
            if (!alertShown) return;
            console.log('[TabletScreen] 연결 요청 타임아웃');
            setStatus('연결 요청 시간 초과');
          }, 30000);
          
          alertShown = true;
          Alert.alert(
            '⚡ 연결 요청 (30초 제한)',
            `모바일 기기에서 연결을 요청했습니다.\n\n연결 코드: ${connectionCode}\n\n⏰ 30초 내에 응답해주세요.\n연결하시겠습니까?`,
            [
              {
                text: '취소',
                style: 'cancel',
                onPress: () => {
                  clearTimeout(timeoutId);
                  alertShown = false;
                  console.log('[TabletScreen] 연결 요청 거부');
                  setStatus('연결 요청이 거부되었습니다');
                }
              },
              {
                text: '연결',
                onPress: () => {
                  clearTimeout(timeoutId);
                  alertShown = false;
                  console.log('[TabletScreen] 연결 요청 승인');
                  setStatus('연결 승인 중...');
                  
                  // 즉시 onConfirm 실행
                  onConfirm()
                    .then(() => {
                      console.log('[TabletScreen] onConfirm 함수 실행 성공');
                    })
                    .catch((error) => {
                      console.error('[TabletScreen] onConfirm 함수 실행 오류:', error);
                      if (error.message.includes('연결이 끊어졌습니다')) {
                        setStatus('⚠️ BLE 연결 끊어짐 - 다시 시도해주세요');
                        Alert.alert('연결 실패', 'BLE 연결이 끊어졌습니다.\n모바일에서 다시 시도해주세요.');
                      } else {
                        setStatus('연결 승인 처리 실패');
                      }
                    });
                }
              }
            ]
          );
        }
      );
      console.log('[TabletScreen] handleIoTRegistrationData 호출 완료');
      
    } catch (error) {
      console.error('[TabletScreen] 데이터 처리 오류:', error);
      setStatus('데이터 처리 오류 발생');
    }
  }, [serialNumber]);

  useEffect(() => {
    const initializeBLE = async () => {
      try {
        setStatus('권한 확인 중...');
        
        const hasPermissions = await requestPermissions();
        if (!hasPermissions) {
          Alert.alert('권한 필요', 'Bluetooth 사용을 위해 필요한 권한을 허용해주세요.');
          return;
        }

        const isBluetoothReady = await checkBluetoothClient();
        if (!isBluetoothReady) {
          throw new Error('Bluetooth를 사용할 수 없습니다');
        }

        cleanupListener.current = await initializePeripheralMode(
          deviceName,
          onDataReceived,
          setStatus
        );
        
        setIsAdvertising(true);
        
      } catch (error) {
        setStatus('초기화 실패');
        
        let errorMessage = 'Bluetooth를 초기화할 수 없습니다.';
        if (error instanceof Error) {
          if (error.message.includes('permission')) {
            errorMessage = '권한이 필요합니다. 앱 설정에서 Bluetooth 권한을 모두 허용해주세요.';
          } else {
            errorMessage = error.message;
          }
        }
        
        Alert.alert('오류', errorMessage, [
          {
            text: '다시 시도',
            onPress: () => setTimeout(() => initializeBLE(), 1000)
          },
          { text: '취소', style: 'cancel' }
         ]);
       }
     };

    initializeBLE();
    
    return () => {
      if (cleanupListener.current) {
        cleanupListener.current();
      }
      stopAdvertising().catch(() => {});
    };
  }, [deviceName, onDataReceived]);

  const handleStopAdvertising = async () => {
    try {
      await stopAdvertising();
      setIsAdvertising(false);
      setStatus('Advertising 중지됨');
    } catch (error) {
      Alert.alert('오류', 'Advertising을 중지할 수 없습니다.');
    }
  };

  const resetConnection = () => {
    setConnectionCode(null);
    setJwtToken(null);
    setConnectedDevices([]);
    setStatus(isAdvertising ? '연결 대기 중...' : 'Advertising 중지됨');
  };

  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>태블릿 - IoT 기기</Text>
        
        <View style={styles.deviceInfoContainer}>
          <Text style={styles.deviceInfoLabel}>기기 정보:</Text>
          <Text style={styles.deviceInfoText}>• 기기명: {deviceName}</Text>
          <Text style={styles.deviceInfoText}>• 시리얼: {serialNumber}</Text>
        </View>
        
        <View style={styles.statusContainer}>
          <Text style={styles.statusLabel}>상태: </Text>
          <Text style={styles.statusText}>{status}</Text>
        </View>
        
        {isAdvertising && (
          <View style={styles.advertisingContainer}>
            <View style={styles.advertisingDot} />
            <Text style={styles.advertisingText}>
              📡 Advertising 중 (모바일에서 스캔 가능)
            </Text>
          </View>
        )}
        
        <View style={styles.buttonContainer}>
          {isAdvertising && (
            <TouchableOpacity
              style={styles.stopButton}
              onPress={handleStopAdvertising}
            >
              <Text style={styles.stopButtonText}>⏹️ Advertising 중지</Text>
            </TouchableOpacity>
          )}
          
          {(connectionCode || jwtToken) && (
            <TouchableOpacity
              style={styles.resetButton}
              onPress={resetConnection}
            >
              <Text style={styles.resetButtonText}>🔄 연결 초기화</Text>
            </TouchableOpacity>
          )}
        </View>
        
        {connectedDevices.length > 0 && (
          <View style={styles.connectionContainer}>
            <Text style={styles.connectionTitle}>
              ✅ 연결된 기기 ({connectedDevices.length})
            </Text>
            {connectedDevices.map((deviceId, index) => (
              <Text key={index} style={styles.deviceItem}>
                • {deviceId}
              </Text>
            ))}
          </View>
        )}
        
        {connectionCode && (
          <View style={styles.dataContainer}>
            <Text style={styles.dataLabel}>수신된 연결 코드:</Text>
            <Text style={styles.dataValue}>{connectionCode}</Text>
          </View>
        )}
        
        {jwtToken && (
          <View style={styles.dataContainer}>
            <Text style={styles.dataLabel}>수신된 JWT 토큰:</Text>
            <Text style={styles.dataValue}>
              {jwtToken.substring(0, 50)}...
            </Text>
          </View>
        )}
        
        <View style={styles.instructionContainer}>
          <Text style={styles.instructionTitle}>📱 연결 방법</Text>
          <Text style={styles.instructionText}>
            1. 태블릿에서 Advertising 실행 중{'\n'}
            2. 모바일 앱에서 "IoT 기기 스캔" 실행{'\n'}
            3. "{deviceName}" 기기 선택{'\n'}
            4. 자동으로 등록 프로세스 진행
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
    textAlign: 'center',
  },
  deviceInfoContainer: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    width: '100%',
    maxWidth: 350,
  },
  deviceInfoLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976d2',
    marginBottom: 8,
  },
  deviceInfoText: {
    fontSize: 14,
    color: '#1565c0',
    marginBottom: 4,
  },
  statusContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 18,
    color: '#666',
  },
  statusText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  advertisingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    padding: 12,
    borderRadius: 10,
    marginBottom: 20,
  },
  advertisingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
    marginRight: 10,
  },
  advertisingText: {
    fontSize: 16,
    color: '#2e7d32',
    fontWeight: '500',
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 350,
    gap: 10,
    marginBottom: 20,
  },
  stopButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 30,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  stopButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  resetButton: {
    backgroundColor: '#6c757d',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  resetButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  connectionContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    width: '100%',
    maxWidth: 350,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  connectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#4caf50',
    marginBottom: 10,
  },
  deviceItem: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  dataContainer: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    width: '100%',
    maxWidth: 350,
  },
  dataLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  dataValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    fontFamily: 'monospace',
  },
  instructionContainer: {
    backgroundColor: '#e8f5e9',
    padding: 15,
    borderRadius: 10,
    width: '100%',
    maxWidth: 350,
  },
  instructionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 8,
  },
  instructionText: {
    fontSize: 14,
    color: '#388e3c',
    lineHeight: 20,
  },
});

export default TabletScreen;