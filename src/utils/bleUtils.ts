// 기본 상수
export const BLE_SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
export const BLE_WRITE_CHARACTERISTIC = '87654321-4321-4321-4321-cba987654321';
export const BLE_READ_CHARACTERISTIC = '11111111-2222-3333-4444-555555555555';

// 연결 코드 생성
export const generateConnectionCode = (): string => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

// 시리얼 번호 생성
export const generateSerialNumber = (): string => {
  const timestamp = Date.now().toString().slice(-6);
  return `TAB-${timestamp}`;
};

// JWT 토큰 생성 (Mock)
export const generateJwtToken = (serialNumber: string): string => {
  const mockPayload = {
    deviceId: serialNumber,
    userId: 'user123',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
  };
  
  // Mock JWT format
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify(mockPayload));
  const signature = 'mock-signature-' + Date.now();
  
  return `${header}.${payload}.${signature}`;
};

// JWT 토큰 검증
export const isValidJwtToken = (token: string): boolean => {
  if (!token) return false;
  const parts = token.split('.');
  return parts.length === 3;
};

// 디바이스 필터링
export const isIoTDevice = (deviceName: string | null): boolean => {
  if (!deviceName) return false;
  
  const iotPatterns = [
    'IoT-',
    'TAB-',
    'TABLET-',
    'MOBILE-',
    'BLE-'
  ];
  
  return iotPatterns.some(pattern => 
    deviceName.toUpperCase().includes(pattern.toUpperCase())
  );
};

// ========================
// 비즈니스 로직 함수들
// ========================

// 데이터 타입 판별
export const getDataType = (data: string): 'connectionCode' | 'serialNumber' | 'jwtToken' | 'unknown' => {
  if (data.length === 6 && /^[A-Z0-9]+$/.test(data)) {
    return 'connectionCode';
  }
  if (data.startsWith('TAB-') || data.startsWith('IOT-') || data.startsWith('TABLET-')) {
    return 'serialNumber';
  }
  if (data.startsWith('eyJ')) {
    return 'jwtToken';
  }
  return 'unknown';
};

// 연결 코드 검증
export const validateConnectionCode = (code: string): boolean => {
  return code.length === 6 && /^[A-Z0-9]+$/.test(code);
};

// 시리얼 번호 검증
export const validateSerialNumber = (serialNumber: string): boolean => {
  return serialNumber.startsWith('TAB-') || 
         serialNumber.startsWith('IOT-') || 
         serialNumber.startsWith('TABLET-');
};

// 서버 통신 시뮬레이션 (JWT 생성)
export const simulateServerRequest = async (serialNumber: string): Promise<string> => {
  // 2초 대기 (서버 통신 시뮬레이션)
  await new Promise(resolve => setTimeout(resolve, 2000));
  return generateJwtToken(serialNumber);
};