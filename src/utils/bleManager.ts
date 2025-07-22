import { BleManager, Device, Subscription, BleError } from 'react-native-ble-plx';
import * as BluetoothClient from 'react-native-bluetooth-client';
import { Platform, NativeModules, NativeEventEmitter } from 'react-native';
import { BLE_SERVICE_UUID, BLE_CHARACTERISTICS } from '../constants/bleConstants';
import { stringToBytes } from './bleUtils';
import { Buffer } from 'buffer';

// BLE Manager 싱글톤 인스턴스
let bleManagerInstance: BleManager | null = null;

export const getBleManager = (): BleManager => {
  if (!bleManagerInstance) {
    bleManagerInstance = new BleManager();
  }
  return bleManagerInstance;
};

// Central 모드 기능 (BleManager 사용)
export const centralMode = {
  // 디바이스에 연결
  connectToDevice: async (device: Device): Promise<Device> => {
    const connectedDevice = await device.connect();
    await connectedDevice.discoverAllServicesAndCharacteristics();
    return connectedDevice;
  },

  // Characteristic에 데이터 쓰기
  writeToCharacteristic: async (
    device: Device,
    serviceUUID: string,
    characteristicUUID: string,
    data: string
  ): Promise<void> => {
    const bytes = stringToBytes(data);
    const base64Data = Buffer.from(bytes).toString('base64');
    
    await device.writeCharacteristicWithResponseForService(
      serviceUUID,
      characteristicUUID,
      base64Data
    );
  },

  // Characteristic 모니터링
  monitorCharacteristic: (
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
          const bytes = Array.from(Buffer.from(characteristic.value, 'base64'));
          const data = String.fromCharCode(...bytes);
          onDataReceived(data);
        }
      }
    );
  },

  // Characteristic 읽기
  readCharacteristic: async (
    device: Device,
    serviceUUID: string,
    characteristicUUID: string
  ): Promise<string | null> => {
    try {
      const characteristic = await device.readCharacteristicForService(
        serviceUUID,
        characteristicUUID
      );
      
      if (characteristic?.value) {
        const bytes = Array.from(Buffer.from(characteristic.value, 'base64'));
        return String.fromCharCode(...bytes);
      }
      return null;
    } catch (error) {
      console.error('Read characteristic error:', error);
      return null;
    }
  },
};

// Peripheral 모드 기능 (BluetoothClient 사용)
export const peripheralMode = {
  // 서비스 설정
  setupService: async (): Promise<void> => {
    try {
      await BluetoothClient.removeAllServices();
    } catch (error) {
      console.log('No existing services to remove:', error);
    }
    
    await BluetoothClient.addService(BLE_SERVICE_UUID, true);
    
    // Characteristics 추가
    await BluetoothClient.addCharacteristicToService(
      BLE_SERVICE_UUID,
      BLE_CHARACTERISTICS.CODE_VERIFY,
      16, // Write permission
      8,  // Write property
      ''
    );
    
    await BluetoothClient.addCharacteristicToService(
      BLE_SERVICE_UUID,
      BLE_CHARACTERISTICS.STATUS,
      1,  // Read permission
      2 | 16, // Read + Notify properties
      ''
    );
    
    await BluetoothClient.addCharacteristicToService(
      BLE_SERVICE_UUID,
      BLE_CHARACTERISTICS.JWT_TOKEN,
      16, // Write permission
      8,  // Write property
      ''
    );
  },

  // Advertising 시작
  startAdvertising: async (deviceName: string): Promise<void> => {
    await BluetoothClient.setName(deviceName);
    await BluetoothClient.startAdvertising(0); // 0 = 무한
  },

  // Advertising 중지
  stopAdvertising: async (): Promise<void> => {
    try {
      await BluetoothClient.stopAdvertising();
    } catch (error) {
      console.error('Stop advertising error:', error);
    }
  },

  // Notification 전송
  sendNotification: async (
    serviceUUID: string,
    characteristicUUID: string,
    data: string
  ): Promise<void> => {
    await BluetoothClient.sendNotificationToDevice(
      serviceUUID,
      characteristicUUID,
      data
    );
  },

  // 데이터 수신 이벤트 리스너 설정
  setupDataListener: (
    onDataReceived: (device: string, data: string) => void
  ): (() => void) => {
    const BluetoothClientModule = NativeModules.BluetoothClient;
    const eventEmitter = new NativeEventEmitter(BluetoothClientModule);
    
    const subscription = eventEmitter.addListener('onReceiveData', (event: any) => {
      try {
        const receivedBytes = event.data;
        const receivedString = String.fromCharCode(...receivedBytes);
        onDataReceived(event.device || 'unknown', receivedString);
      } catch (error) {
        console.error('Data receive error:', error);
      }
    });
    
    return () => subscription.remove();
  },
};

// 공통 유틸리티
export const bleCommon = {
  // BLE 상태 확인
  checkBleState: async (): Promise<boolean> => {
    const manager = getBleManager();
    const state = await manager.state();
    return state === 'PoweredOn';
  },

  // 권한 확인 (Android)
  checkPermissions: async (): Promise<boolean> => {
    if (Platform.OS === 'ios') return true;
    
    try {
      await BluetoothClient.checkBluetooth();
      return true;
    } catch (error) {
      return false;
    }
  },

  // 정리
  cleanup: () => {
    if (bleManagerInstance) {
      bleManagerInstance.destroy();
      bleManagerInstance = null;
    }
  },
};