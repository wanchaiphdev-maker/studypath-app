import { io, Socket } from "socket.io-client";
import * as SecureStore from "expo-secure-store";
import { BASE_URL } from "./api";

let socket: Socket | null = null;

// เปิดการเชื่อมต่อ Socket.IO (แนบ JWT ไปในการจับมือ)
export async function getSocket(): Promise<Socket> {
  if (!BASE_URL) throw new Error("ตั้งค่า EXPO_PUBLIC_API_URL ในไฟล์ .env ก่อน");
  const token = await SecureStore.getItemAsync("token");
  if (!token) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");

  if (!socket) {
    socket = io(BASE_URL, { autoConnect: false, transports: ["websocket"] });
  }
  socket.auth = { token };
  if (!socket.connected) socket.connect();
  return socket;
}

// ตัดการเชื่อมต่อ (ใช้ตอนออกจากระบบ)
export function closeSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}
