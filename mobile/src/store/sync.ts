import { create } from "zustand";
import {
  discoverDesktop,
  pairWithDesktop,
  getSyncMeta,
  setSyncMeta,
  startWebSocket,
  stopWebSocket,
  fullSync,
  isConnected,
  SYNC_PORT,
} from "../services/sync";

type SyncStore = {
  ip: string;
  paired: boolean;
  peerName: string | null;
  connected: boolean;
  lastSync: number | null;
  syncing: boolean;
  error: string | null;

  init: () => Promise<void>;
  setIp: (ip: string) => void;
  discover: () => Promise<boolean>;
  pair: (code: string) => Promise<boolean>;
  connect: () => void;
  disconnect: () => void;
  syncNow: () => Promise<void>;
};

export const useSyncStore = create<SyncStore>((set, get) => ({
  ip: "",
  paired: false,
  peerName: null,
  connected: false,
  lastSync: null,
  syncing: false,
  error: null,

  init: async () => {
    const ip = (await getSyncMeta("paired_ip")) ?? "";
    const peerName = await getSyncMeta("paired_device");
    const paired = !!peerName;
    const lastSync = await getSyncMeta("last_pull_at");
    set({ ip, paired, peerName, lastSync: lastSync ? Number(lastSync) : null });

    if (paired && ip) {
      get().connect();
    }
  },

  setIp: (ip: string) => set({ ip }),

  discover: async () => {
    const { ip } = get();
    if (!ip) return false;
    const resp = await discoverDesktop(ip);
    if (resp) {
      set({ peerName: resp.device_name });
      return true;
    }
    set({ error: "Desktop not found at this IP" });
    return false;
  },

  pair: async (code: string) => {
    const { ip } = get();
    if (!ip) return false;
    const deviceName = "Android";
    const resp = await pairWithDesktop(ip, code, deviceName);
    if (resp?.paired) {
      set({ paired: true, peerName: resp.device_name, error: null });
      get().connect();
      return true;
    }
    set({ error: "Invalid pairing code" });
    return false;
  },

  connect: () => {
    const { ip } = get();
    if (!ip) return;
    startWebSocket(ip, () => {
      set({ connected: isConnected() });
    });
    setTimeout(() => set({ connected: isConnected() }), 1000);
  },

  disconnect: () => {
    stopWebSocket();
    set({ connected: false });
  },

  syncNow: async () => {
    const { ip, paired } = get();
    if (!ip || !paired) return;
    set({ syncing: true, error: null });
    try {
      await fullSync(ip);
      set({ lastSync: Date.now(), syncing: false });
      await setSyncMeta("last_pull_at", String(Date.now()));
    } catch (e: unknown) {
      set({ syncing: false, error: e instanceof Error ? e.message : "Sync failed" });
    }
  },
}));
