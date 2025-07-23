package com.bletransferapp.bluetooth;


import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.AdvertisingSet;
import android.bluetooth.le.AdvertisingSetCallback;
import android.bluetooth.le.AdvertisingSetParameters;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.provider.SyncStateContract;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.core.app.ActivityCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import android.bluetooth.BluetoothGattDescriptor;

@ReactModule(name = BluetoothClientModule.NAME)
public class BluetoothClientModule extends ReactContextBaseJavaModule {

    private static final String TAG = BluetoothClientModule.class.getSimpleName();
    public static final String NAME = "BluetoothClient";
    public static final int ADVERTISING_TIMED_OUT = 6;
    private BluetoothAdapter bluetoothAdapter;
    private static final int REQUEST_ENABLE_BT = 1;
    private BluetoothLeAdvertiser mBluetoothLeAdvertiser;
    private Handler mHandler;
    private Intent enableBtIntent;
    private Runnable timeoutRunnable;
    private long TIMEOUT = 0;
    private AdvertiseCallback mAdvertiseCallback;
    HashMap<String, BluetoothGattService> servicesMap;
    HashSet<BluetoothDevice> mBluetoothDevices;
    BluetoothGattServer mGattServer;
    private String sendData = "";
    private String name = "RnBLE";
    private BluetoothGatt mBluetoothGatt;

    public BluetoothClientModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
        this.servicesMap = new HashMap<String, BluetoothGattService>();
    }

    @Override
    @NonNull
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void setName(String name) {
        Log.d(TAG, "set name = " + name);
        this.name = name;
    }

    // Example method
    // See https://reactnative.dev/docs/native-modules-android
    @ReactMethod
    public void multiply(double a, double b, Promise promise) {
        promise.resolve(a * b);
    }


    /**
     * 블루투스를 지원하는 기기인지 확인하는 메소드
     *
     * @param promise
     */
    @ReactMethod
    public void checkBluetooth(Promise promise) {
        if (bluetoothAdapter == null) {
            promise.reject("bluetooth not supported", "...");
        } else {
            promise.resolve(5);
        }
    }

    /**
     * 블루투스가 꺼져있으면 블루투스를 활성화 시킬 수 있게 도와주는 메소드
     * 구현하는 측에서 권한을 설정해야 정상적으로 사용이 가능하다.
     */
    @ReactMethod
    public void enableBluetooth() {
        if (!bluetoothAdapter.isEnabled()) {
            ReactApplicationContext context = getReactApplicationContext();
            Intent enableBtIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
            context.startActivityForResult(enableBtIntent, REQUEST_ENABLE_BT, null);

        }
    }


    @ReactMethod
    public void startAdvertising(int t ,Promise promise) {
        int timeout = t;
        this.bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
        Log.d(TAG, "ad start");
        if (mBluetoothLeAdvertiser == null) {
            Log.d(TAG, "advertiser not null");
            ReactApplicationContext context = getReactApplicationContext();
            BluetoothManager mBluetoothManger = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);

            if (mBluetoothManger != null) {
                Log.d(TAG, "manager not null");
                Log.d(TAG, this.name);
                bluetoothAdapter = mBluetoothManger.getAdapter();
                // Android 12+ (API 31+)에서만 BLUETOOTH_CONNECT 권한 체크
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                        promise.reject("permission error", "Please allow permission to use Bluetooth.");
                        return;
                    }
                }
                bluetoothAdapter.setName(this.name);

                if (bluetoothAdapter != null) {
                    // 기본 광고 시간 관련해서 기본 값을 3분으로 준다.
                    if (timeout >= 3) {
                        timeout = 3;
                    }
                    TIMEOUT = timeout;
                    if (bluetoothAdapter.isMultipleAdvertisementSupported()) {
                        //여기에 광고 시작 코드를 넣는다.
                        mBluetoothDevices = new HashSet<>();
                        mGattServer = mBluetoothManger.openGattServer(getReactApplicationContext(), mGattServerCallback);
                        for (BluetoothGattService service : this.servicesMap.values()) {
                            mGattServer.addService(service);
                        }
                        mBluetoothLeAdvertiser = bluetoothAdapter.getBluetoothLeAdvertiser();

                        if (mAdvertiseCallback == null) {
                            AdvertiseSettings settings = buildAdvertiseSettings();
                            AdvertiseData data = buildAdvertiseData();
                            AdvertiseData scanRes = new AdvertiseData.Builder()
                                .setIncludeDeviceName(true)
                                .build();
                            mAdvertiseCallback = new SampleAdvertiseCallback(promise);

                            if (mBluetoothLeAdvertiser != null) {
                                Log.d(TAG, settings.toString());
                                Log.d(TAG, data.toString());
                                if (mAdvertiseCallback != null) {
                                    mBluetoothLeAdvertiser.startAdvertising(settings, data, scanRes, mAdvertiseCallback);


                                }
                            }
                        }

                    } else {
                        promise.reject("Bluetooth BLE not supported.");

                    }
                }
            }
        } else {
            if (mAdvertiseCallback == null) {
                bluetoothAdapter.setName(this.name);
                AdvertiseSettings settings = buildAdvertiseSettings();
                AdvertiseData data = buildAdvertiseData();
                AdvertiseData scanRes = new AdvertiseData.Builder()
                    .setIncludeDeviceName(true)
                    .build();
                mAdvertiseCallback = new SampleAdvertiseCallback(promise);

                if (mBluetoothLeAdvertiser != null) {
                    Log.d(TAG, settings.toString());
                    Log.d(TAG, data.toString());
                    if (mAdvertiseCallback != null) {
                        mBluetoothLeAdvertiser.startAdvertising(settings, data, scanRes, mAdvertiseCallback);

                        promise.resolve("Bluetooth BLE Advertising start.");
                    }
                }
            }
        }

    }


    /**
     * Starts a delayed Runnable that will cause the BLE Advertising to timeout and stop after a
     * set amount of time.
     */
//    private void setTimeout() {
//        mHandler = new Handler();
//        Log.d(TAG, "set timeout");
//        timeoutRunnable = new Runnable() {
//            @Override
//            public void run() {
//                Log.d(TAG, "AdvertiserService has reached timeout of " + TIMEOUT + " milliseconds, stopping advertising.");
//                sendFailureIntent(ADVERTISING_TIMED_OUT);
//                ReactApplicationContext context = getReactApplicationContext();
//                context.stopService(enableBtIntent);
//            }
//        };
//        mHandler.postDelayed(timeoutRunnable, TIMEOUT);
//    }


    /**
     * 광고가 실패했다는 것을 보내주는 함수
     */
    private int sendFailureIntent(int errorCode) {
        return errorCode;
    }

    /**
     * 저전력을 사용하도록 설정된 AdvertiseSettings 개체를 반환하고(배터리 수명을 유지하기 위해) 이 코드는 자체 타임아웃 실행 가능 파일을 사용하기 때문에 기본 제공 타임아웃을 비활성화합니다.
     * @return
     */
    private AdvertiseSettings buildAdvertiseSettings() {
        AdvertiseSettings.Builder settingsBuilder = new AdvertiseSettings.Builder();
        settingsBuilder.setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER);
        settingsBuilder.setTimeout((int) TimeUnit.MILLISECONDS.convert(TIMEOUT, TimeUnit.MINUTES));
        settingsBuilder.setConnectable(true);
        return settingsBuilder.build();
    }


    /**
     * 서비스 UUID 및 장치 이름을 포함하는 AdvertiseData 개체를 반환합니다.
     */
    private AdvertiseData buildAdvertiseData() {

        /**
         * 참고: BLE 광고를 통해 전송된 패킷에는 31바이트로 엄격한 제한이 있습니다.
         * 여기에는 UUID, 장치 정보, 임의 서비스 또는 제조업체 데이터를 포함하여 AdvertiseData에 입력된 모든 것이 포함됩니다.
         * 이 제한을 초과하여 패킷을 보내려고 하면 오류 코드 AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE와 함께 실패합니다.
         * AdvertiseCallback 구현의 onStartFailure() 메소드에서 이 오류를 포착하십시오.
         */

        AdvertiseData.Builder dataBuilder = new AdvertiseData.Builder();
        dataBuilder.addServiceUuid(Constants.Service_UUID);
        dataBuilder.setIncludeDeviceName(true);

        /* For example - this will cause advertising to fail (exceeds size limit) */
//        String failureData = "1";

        return dataBuilder.build();
    }


    /**
     * 광고 시작 후 사용자 정의 콜백 성공 또는 실패.
     * AdvertiserFragment에 의해 선택될 인텐트의 오류 코드를 브로드캐스트하고 이 서비스를 중지합니다.
     */
    private class SampleAdvertiseCallback extends AdvertiseCallback {

        private Promise promise;

        public SampleAdvertiseCallback(Promise promise) {
            this.promise = promise;
        }

        @Override
        public void onStartFailure(int errorCode) {
            super.onStartFailure(errorCode);

            Log.d(TAG, "Advertising failed");
            promise.reject("error", errorCode + "");
            sendFailureIntent(errorCode);
            ReactApplicationContext context = getReactApplicationContext();
            context.stopService(enableBtIntent);

        }

        @Override
        public void onStartSuccess(AdvertiseSettings settingsInEffect) {
            super.onStartSuccess(settingsInEffect);
            promise.resolve("Bluetooth BLE Advertising started.");
            Log.d(TAG, "Advertising successfully started");
        }
    }

    /**
     * 홍보를 중지하는 메소드. 광고를 중지하기 위해서는 해당 메소드를 실행하거나 앱을 완전히 종료해야한다.
     * @param promise
     */
    @ReactMethod
    public void stopAdvertising(Promise promise) {
        try {
            Log.d(TAG, "Service: Stopping Advertising");
            if (mBluetoothLeAdvertiser != null) {
                // Android 12+ (API 31+)에서만 BLUETOOTH_ADVERTISE 권한 체크
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                        promise.reject("error", "Please allow permission to use Bluetooth.");
                        return;
                    }
                }
                mBluetoothLeAdvertiser.stopAdvertising(mAdvertiseCallback);
                mAdvertiseCallback = null;
                mBluetoothLeAdvertiser = null;
                promise.resolve("ok");
            }
        } catch (Exception e) {
            promise.reject("error", e);
        }
    }

    @ReactMethod
    public void addService(String uuid, boolean primary) {
        Log.d(TAG, "=== addService 시작 ===");
        Log.d(TAG, "Service UUID: " + uuid);
        Log.d(TAG, "Primary: " + primary);
        
        UUID SERVICE_UUID = UUID.fromString(uuid);
        int type = primary == true ? 0 : 1;
        BluetoothGattService tempService = new BluetoothGattService(SERVICE_UUID, type);
        Log.d(TAG, "Service created successfully");
        Log.d(TAG, "Current characteristics: " + tempService.getCharacteristics().toString());
        Log.d(TAG, "Included services: " + tempService.getIncludedServices().toString());
        
        if (!this.servicesMap.containsKey(uuid)) {
            this.servicesMap.put(uuid, tempService);
            Log.d(TAG, "Service added to map. Total services: " + this.servicesMap.size());
        } else {
            Log.d(TAG, "Service already exists in map");
        }
    }

    @ReactMethod
    public void addCharacteristicToService(String serviceUUID, String uuid, Integer permissions, Integer properties, String data) {
        Log.d(TAG, "=== addCharacteristicToService 시작 ===");
        Log.d(TAG, "Service UUID: " + serviceUUID);
        Log.d(TAG, "Characteristic UUID: " + uuid);
        Log.d(TAG, "Permissions: " + permissions);
        Log.d(TAG, "Properties: " + properties);
        Log.d(TAG, "Data: " + data);
        
        UUID CHAR_UUID = UUID.fromString(uuid);
        BluetoothGattCharacteristic tempChar = new BluetoothGattCharacteristic(CHAR_UUID, properties, permissions);
        
        // iOS 호환성을 위한 CCCD descriptor 추가 (notify 또는 indicate 속성이 있는 경우)
        if ((properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0 || 
            (properties & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) {
            
            Log.d(TAG, "Adding CCCD descriptor for iOS compatibility");
            UUID CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
            BluetoothGattDescriptor cccdDescriptor = new BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE
            );
            
            // CCCD 기본값 설정 (notification disabled)
            cccdDescriptor.setValue(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);
            tempChar.addDescriptor(cccdDescriptor);
            
            Log.d(TAG, "CCCD descriptor added successfully");
        }
        
        BluetoothGattService service = this.servicesMap.get(serviceUUID);
        if (service != null) {
            service.addCharacteristic(tempChar);
            Log.d(TAG, "Characteristic added successfully. Service now has " + service.getCharacteristics().size() + " characteristics");
        } else {
            Log.e(TAG, "Service not found for UUID: " + serviceUUID);
        }
    }


    private final BluetoothGattServerCallback mGattServerCallback = new BluetoothGattServerCallback() {
        @Override
        public void onConnectionStateChange(BluetoothDevice device, final int status, int newState) {
            super.onConnectionStateChange(device, status, newState);
            Log.d(TAG, "=== onConnectionStateChange ===");
            Log.d(TAG, "Device: " + device.toString());
            Log.d(TAG, "Status: " + status);
            Log.d(TAG, "NewState: " + newState);
            
            if (status == BluetoothGatt.GATT_SUCCESS) {
                if (newState == BluetoothGatt.STATE_CONNECTED) {
                    mBluetoothDevices.add(device);
                    Log.d(TAG, "기기 연결됨! Connected devices count: " + mBluetoothDevices.size());
                    Log.d(TAG, "Connected devices: " + mBluetoothDevices.toString());
                } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                    Log.d(TAG, "기기 연결 해제됨!");
                    mBluetoothDevices.remove(device);
                    Log.d(TAG, "Remaining devices count: " + mBluetoothDevices.size());
                }
            } else {
                Log.d(TAG, "연결 실패! Status: " + status);
                mBluetoothDevices.remove(device);
            }
        }
        @SuppressLint("MissingPermission")
        @Override
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset,
                                                BluetoothGattCharacteristic characteristic) {
            Log.d(TAG, "데이터를 요청?");
            super.onCharacteristicReadRequest(device, requestId, offset, characteristic);
            if (offset != 0) {

                mGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset,
                    /* value (optional) */ "hi".getBytes(StandardCharsets.UTF_8));
                return;
            }
            characteristic.setValue(sendData.getBytes(StandardCharsets.UTF_8));
            mGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS,
                offset, characteristic.getValue());
        }

        @Override
        public void onNotificationSent(BluetoothDevice device, int status) {
            super.onNotificationSent(device, status);
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId,
                                                 BluetoothGattCharacteristic characteristic, boolean preparedWrite, boolean responseNeeded,
                                                 int offset, byte[] value) {
            super.onCharacteristicWriteRequest(device, requestId, characteristic, preparedWrite,
                responseNeeded, offset, value);
            
            Log.d(TAG, "=== onCharacteristicWriteRequest 시작 ===");
            Log.d(TAG, "Device: " + device.toString());
            Log.d(TAG, "RequestId: " + requestId);
            Log.d(TAG, "Characteristic UUID: " + characteristic.getUuid().toString());
            Log.d(TAG, "PreparedWrite: " + preparedWrite);
            Log.d(TAG, "ResponseNeeded: " + responseNeeded);
            Log.d(TAG, "Offset: " + offset);
            Log.d(TAG, "Value length: " + (value != null ? value.length : 0));
            
            if (value != null) {
                String receivedString = new String(value, StandardCharsets.UTF_8);
                Log.d(TAG, "Received string: " + receivedString);
            }
            
            characteristic.setValue(value);
            WritableMap map = Arguments.createMap();
            WritableArray data = Arguments.createArray();
            for (byte b : value) {
                data.pushInt((int) b);
            }
            map.putArray("data", data);
            map.putString("device", device.toString());
            Log.d(TAG, "데이터는 ~~~~~~~~");
            Log.d(TAG, map.toString());
            
            if (responseNeeded) {
                Log.d(TAG, "Sending response to device");
                mGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
                Log.d(TAG, "Emitting onReceiveData event");
                getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("onReceiveData", map);
                Log.d(TAG, "Event emitted successfully");
            } else {
                Log.d(TAG, "Response not needed, but still emitting event");
                getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("onReceiveData", map);
            }
            Log.d(TAG, "=== onCharacteristicWriteRequest 완료 ===");
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId,
                                             BluetoothGattDescriptor descriptor, boolean preparedWrite, boolean responseNeeded,
                                             int offset, byte[] value) {
            super.onDescriptorWriteRequest(device, requestId, descriptor, preparedWrite, responseNeeded, offset, value);
            
            Log.d(TAG, "=== onDescriptorWriteRequest 시작 ===");
            Log.d(TAG, "Device: " + device.toString());
            Log.d(TAG, "Descriptor UUID: " + descriptor.getUuid().toString());
            Log.d(TAG, "Value: " + (value != null ? java.util.Arrays.toString(value) : "null"));
            
            // CCCD descriptor 처리 (iOS 호환성)
            if (descriptor.getUuid().toString().toLowerCase().equals("00002902-0000-1000-8000-00805f9b34fb")) {
                if (value != null && value.length >= 2) {
                    boolean notificationsEnabled = (value[0] & 0x01) != 0;
                    boolean indicationsEnabled = (value[0] & 0x02) != 0;
                    
                    Log.d(TAG, "CCCD 설정 - Notifications: " + notificationsEnabled + ", Indications: " + indicationsEnabled);
                    
                    // descriptor 값 설정
                    descriptor.setValue(value);
                    
                    if (responseNeeded) {
                        Log.d(TAG, "CCCD write response 전송");
                        mGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
                    }
                } else {
                    Log.e(TAG, "Invalid CCCD value");
                    if (responseNeeded) {
                        mGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_ATTRIBUTE_LENGTH, offset, null);
                    }
                }
            } else {
                Log.d(TAG, "다른 descriptor write 요청");
                if (responseNeeded) {
                    mGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
                }
            }
            
            Log.d(TAG, "=== onDescriptorWriteRequest 완료 ===");
        }
    };

    @SuppressLint("MissingPermission")
    @ReactMethod
    public void sendNotificationToDevice(String serviceUUID, String charUUID, String message, Promise promise){
        Log.d(TAG, "데이터는 ~~~~~~~~");
        Log.d(TAG, serviceUUID+"/"+charUUID+"/"+ message);
        byte[] decoded = message.getBytes(StandardCharsets.UTF_8);

        try{
            // 서비스 uuid를 가지고 특성 uuid를 꺼내오는 과정
            BluetoothGattCharacteristic characteristic = servicesMap.get(serviceUUID).getCharacteristic(UUID.fromString(charUUID));
            characteristic.setValue(decoded);
            boolean indicate = (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) == BluetoothGattCharacteristic.PROPERTY_INDICATE;

            for(BluetoothDevice device : mBluetoothDevices){
                mGattServer.notifyCharacteristicChanged(device, characteristic, false);
                Log.d(TAG, "device = "+device);
            }
            promise.resolve("Send Notification Success");
        }catch (Exception e){
            promise.reject("fail", "Send Notification Fail");
        }

    }

    @ReactMethod
    public void setSendData(String data){
        this.sendData = data;
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    public void removeAllServices(Promise promise){
        try{
            for (BluetoothGattService service : this.servicesMap.values()) {
                mGattServer.removeService(service);
            }
            mGattServer.clearServices();
            this.servicesMap = new HashMap<String, BluetoothGattService>();
            promise.resolve("remove success");
        }catch (Exception e){
            promise.reject("remove fail");
        }
    }

} 