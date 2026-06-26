import { useCallback } from 'react';

const DB_NAME = 'crm-offline';
const DB_VERSION = 1;
const STORES = {
  students: 'students',
  tasks: 'tasks',
  pendingSync: 'pendingSync',
};

/**
 * IndexedDB 离线存储 Hook
 *
 * 功能：
 * - 缓存学生列表和任务数据
 * - 离线时暂存操作，网络恢复后自动同步
 * - 支持增量更新
 */
export default function useOfflineStorage() {

  const openDB = useCallback(() => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 学生数据存储
        if (!db.objectStoreNames.contains(STORES.students)) {
          const store = db.createObjectStore(STORES.students, { keyPath: 'id' });
          store.createIndex('by_status', 'status', { unique: false });
          store.createIndex('by_school', 'school_name', { unique: false });
        }

        // 任务数据存储
        if (!db.objectStoreNames.contains(STORES.tasks)) {
          const store = db.createObjectStore(STORES.tasks, { keyPath: 'id' });
          store.createIndex('by_assigned', 'assigned_to', { unique: false });
        }

        // 待同步操作队列
        if (!db.objectStoreNames.contains(STORES.pendingSync)) {
          const store = db.createObjectStore(STORES.pendingSync, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('by_timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }, []);

  // 保存学生列表
  const saveStudents = useCallback(async (students) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORES.students, 'readwrite');
      const store = tx.objectStore(STORES.students);

      for (const student of students) {
        store.put({ ...student, _cachedAt: Date.now() });
      }

      return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (e) {
      console.error('[Offline] Save students failed:', e);
    }
  }, [openDB]);

  // 获取缓存的学生列表
  const getStudents = useCallback(async () => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORES.students, 'readonly');
      const store = tx.objectStore(STORES.students);

      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          db.close();
          resolve(request.result);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('[Offline] Get students failed:', e);
      return [];
    }
  }, [openDB]);

  // 保存任务数据
  const saveTasks = useCallback(async (tasks, stats, schools) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORES.tasks, 'readwrite');
      const store = tx.objectStore(STORES.tasks);

      // 存储任务列表
      store.put({
        id: 'current_tasks',
        tasks,
        stats,
        schools,
        _cachedAt: Date.now(),
      });

      return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (e) {
      console.error('[Offline] Save tasks failed:', e);
    }
  }, [openDB]);

  // 获取缓存的任务
  const getTasks = useCallback(async () => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORES.tasks, 'readonly');
      const store = tx.objectStore(STORES.tasks);

      return new Promise((resolve, reject) => {
        const request = store.get('current_tasks');
        request.onsuccess = () => {
          db.close();
          resolve(request.result);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('[Offline] Get tasks failed:', e);
      return null;
    }
  }, [openDB]);

  // 添加待同步操作
  const addPendingSync = useCallback(async (operation) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORES.pendingSync, 'readwrite');
      const store = tx.objectStore(STORES.pendingSync);

      store.add({
        ...operation,
        timestamp: Date.now(),
        synced: false,
      });

      return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (e) {
      console.error('[Offline] Add pending sync failed:', e);
    }
  }, [openDB]);

  // 获取待同步操作
  const getPendingSync = useCallback(async () => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORES.pendingSync, 'readonly');
      const store = tx.objectStore(STORES.pendingSync);

      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          db.close();
          resolve(request.result.filter((item) => !item.synced));
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('[Offline] Get pending sync failed:', e);
      return [];
    }
  }, [openDB]);

  // 标记操作已同步
  const markSynced = useCallback(async (id) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORES.pendingSync, 'readwrite');
      const store = tx.objectStore(STORES.pendingSync);

      const request = store.get(id);
      request.onsuccess = () => {
        const data = request.result;
        if (data) {
          data.synced = true;
          store.put(data);
        }
      };

      return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (e) {
      console.error('[Offline] Mark synced failed:', e);
    }
  }, [openDB]);

  // 清除所有缓存
  const clearCache = useCallback(async () => {
    try {
      const db = await openDB();
      const tx = db.transaction(
        [STORES.students, STORES.tasks, STORES.pendingSync],
        'readwrite'
      );

      tx.objectStore(STORES.students).clear();
      tx.objectStore(STORES.tasks).clear();
      tx.objectStore(STORES.pendingSync).clear();

      return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch (e) {
      console.error('[Offline] Clear cache failed:', e);
    }
  }, [openDB]);

  return {
    saveStudents,
    getStudents,
    saveTasks,
    getTasks,
    addPendingSync,
    getPendingSync,
    markSynced,
    clearCache,
  };
}
