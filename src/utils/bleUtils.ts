import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import { BLE_CHUNK_DATA_SIZE } from '../constants/bleConstants';

export const generateConnectionCode = (): string => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

export const stringToBytes = (str: string): number[] => {
  // React Native 호환 방식: Buffer 사용
  return Array.from(Buffer.from(str, 'utf8'));
};

export const bytesToString = (bytes: number[]): string => {
  // React Native 호환 방식: Buffer 사용
  try {
    return Buffer.from(bytes).toString('utf8');
  } catch (error) {
    // 실패시 fallback 방식 사용
    console.warn('Buffer conversion failed, using fallback:', error);
    return String.fromCharCode(...bytes);
  }
};

export const chunkData = (data: string): string[] => {
  const bytes = stringToBytes(data);
  const chunks: string[] = [];
  const totalChunks = Math.ceil(bytes.length / BLE_CHUNK_DATA_SIZE);
  
  for (let i = 0; i < totalChunks; i++) {
    const chunkStart = i * BLE_CHUNK_DATA_SIZE;
    const chunkEnd = Math.min(chunkStart + BLE_CHUNK_DATA_SIZE, bytes.length);
    const chunkBytes = bytes.slice(chunkStart, chunkEnd);
    
    const header = [i, totalChunks];
    const fullChunk = [...header, ...chunkBytes];
    
    chunks.push(bytesToString(fullChunk));
  }
  
  return chunks;
};

export const assembleChunks = (chunks: Map<number, string>): string | null => {
  const sortedChunks = Array.from(chunks.entries())
    .sort(([a], [b]) => a - b)
    .map(([_, chunk]) => chunk);
  
  try {
    let assembled = '';
    for (const chunk of sortedChunks) {
      const bytes = stringToBytes(chunk);
      if (bytes.length < 2) continue;
      
      const data = bytes.slice(2);
      assembled += bytesToString(data);
    }
    return assembled;
  } catch (error) {
    console.error('Error assembling chunks:', error);
    return null;
  }
};