import { useEffect, useState } from 'react';
import "./Popup.css";

// Simple chrome API types
interface ChromeTab {
  id?: number;
  url?: string;
}

interface ChromeAPI {
  tabs: {
    query: (queryInfo: { active: boolean; currentWindow: boolean }) => Promise<ChromeTab[]>;
  };
  scripting: {
    executeScript: (injection: { target: { tabId: number }; func: () => Promise<any> }) => Promise<Array<{ result: any }>>;
  };
}

declare const chrome: ChromeAPI;

export default function () {
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractFirebaseRefreshToken = async () => {
    setLoading(true);
    setError(null);

    try {
      // Query the active tab to execute script in neetcode.io context
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id || !tab.url?.includes('neetcode.io')) {
        throw new Error('Please navigate to neetcode.io first');
      }

      // Execute script in the page context to access storage
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          const debugInfo: any = {
            localStorage: {},
            indexedDB: null,
            error: null
          };

          try {
            // First, try localStorage for Firebase auth data
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.includes('firebase')) {
                const value = localStorage.getItem(key);
                debugInfo.localStorage[key] = value;

                if (value) {
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed.stsTokenManager && parsed.stsTokenManager.refreshToken) {
                      return {
                        token: parsed.stsTokenManager.refreshToken,
                        source: 'localStorage',
                        key: key,
                        debug: debugInfo
                      };
                    }
                  } catch (e) {
                    // Continue searching
                  }
                }
              }
            }

            // Then try IndexedDB
            return new Promise((resolve) => {
              const request = indexedDB.open('firebaseLocalStorageDb');

              request.onerror = () => {
                debugInfo.error = 'Failed to open Firebase database';
                resolve({ token: null, source: 'indexedDB-error', debug: debugInfo });
              };

              request.onsuccess = (event) => {
                try {
                  const db = (event.target as IDBOpenDBRequest).result;
                  debugInfo.indexedDB = {
                    name: db.name,
                    version: db.version,
                    objectStoreNames: Array.from(db.objectStoreNames)
                  };

                  // Try different possible object store names
                  const possibleStoreNames = ['firebaseLocalStorage', 'fbase_key'];
                  let storeFound = false;

                  for (const storeName of possibleStoreNames) {
                    if (db.objectStoreNames.contains(storeName)) {
                      storeFound = true;
                      const transaction = db.transaction([storeName], 'readonly');
                      const store = transaction.objectStore(storeName);
                      const getAllRequest = store.getAll();

                      getAllRequest.onsuccess = () => {
                        const records = getAllRequest.result;
                        debugInfo.indexedDB.recordCount = records.length;
                        debugInfo.indexedDB.usedStore = storeName;

                        for (const record of records) {
                          // Handle different record structures
                          let dataToCheck = null;

                          if (record.value && typeof record.value === 'string') {
                            try {
                              dataToCheck = JSON.parse(record.value);
                            } catch (e) {
                              continue;
                            }
                          } else if (record.value && typeof record.value === 'object') {
                            dataToCheck = record.value;
                          } else if (typeof record === 'object' && record !== null) {
                            dataToCheck = record;
                          }

                          if (dataToCheck) {
                            // Check for Firebase auth structure
                            if (dataToCheck.stsTokenManager && dataToCheck.stsTokenManager.refreshToken) {
                              resolve({
                                token: dataToCheck.stsTokenManager.refreshToken,
                                source: 'indexedDB',
                                debug: debugInfo
                              });
                              return;
                            }

                            // Check for direct refreshToken
                            if (dataToCheck.refreshToken) {
                              resolve({
                                token: dataToCheck.refreshToken,
                                source: 'indexedDB',
                                debug: debugInfo
                              });
                              return;
                            }
                          }
                        }

                        resolve({ token: null, source: 'indexedDB-not-found', debug: debugInfo });
                      };

                      getAllRequest.onerror = () => {
                        debugInfo.error = `Failed to read Firebase data from store: ${storeName}`;
                        resolve({ token: null, source: 'indexedDB-read-error', debug: debugInfo });
                      };

                      break; // Exit the loop once we find a valid store
                    }
                  }

                  if (!storeFound) {
                    debugInfo.error = `No valid object stores found. Available: ${Array.from(db.objectStoreNames).join(', ')}`;
                    resolve({ token: null, source: 'indexedDB-no-store', debug: debugInfo });
                  }
                } catch (e) {
                  debugInfo.error = `IndexedDB error: ${e}`;
                  resolve({ token: null, source: 'indexedDB-exception', debug: debugInfo });
                }
              };
            });
          } catch (e) {
            debugInfo.error = `General error: ${e}`;
            return { token: null, source: 'general-error', debug: debugInfo };
          }
        }
      });

      const result = results[0]?.result as any;
      console.log('Debug info:', result);

      if (result?.token) {
        setRefreshToken(result.token);
      } else {
        let errorMsg = 'No refresh token found. ';
        if (result?.debug) {
          const debug = result.debug;
          if (debug.error) {
            errorMsg += `Error: ${debug.error}. `;
          }
          if (debug.localStorage && Object.keys(debug.localStorage).length > 0) {
            errorMsg += `Found ${Object.keys(debug.localStorage).length} Firebase localStorage items. `;
          }
          if (debug.indexedDB) {
            errorMsg += `IndexedDB: ${debug.indexedDB.recordCount || 0} records found. `;
          }
        }
        errorMsg += 'Make sure you are logged in to neetcode.io';
        setError(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract refresh token');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log("Hello from the popup!");
  }, []);

  return (
    <div style={{ padding: '20px', minWidth: '300px' }}>
      <img src="/icon-with-shadow.svg" />
      <h1>Firebase Token Extractor</h1>

      <button
        onClick={extractFirebaseRefreshToken}
        disabled={loading}
        style={{
          padding: '10px 20px',
          backgroundColor: '#4285f4',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          marginBottom: '10px',
          marginRight: '10px'
        }}
      >
        {loading ? 'Extracting...' : 'Extract Refresh Token'}
      </button>

      <button
        onClick={async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab.id) {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: async () => {
                console.log('=== FIREBASE DEBUG INFO ===');
                console.log('Current URL:', window.location.href);
                console.log('LocalStorage keys:', Object.keys(localStorage));

                // Log all Firebase-related localStorage items
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (key && key.includes('firebase')) {
                    console.log(`Firebase localStorage [${key}]:`, localStorage.getItem(key));
                  }
                }

                // Check IndexedDB
                try {
                  const dbs = await indexedDB.databases();
                  console.log('Available IndexedDB databases:', dbs);
                } catch (e) {
                  console.log('IndexedDB error:', e);
                }

                return 'Debug complete - check console';
              }
            });
          }
        }}
        style={{
          padding: '10px 20px',
          backgroundColor: '#ff9800',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: '10px'
        }}
      >
        Debug (Check Console)
      </button>

      {error && (
        <div style={{ color: 'red', marginBottom: '10px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {refreshToken && (
        <div>
          <h3>Refresh Token:</h3>
          <textarea
            value={refreshToken}
            readOnly
            style={{
              width: '100%',
              height: '100px',
              fontSize: '12px',
              fontFamily: 'monospace',
              padding: '8px',
              border: '1px solid #ccc',
              borderRadius: '4px'
            }}
          />
          <button
            onClick={() => navigator.clipboard.writeText(refreshToken)}
            style={{
              marginTop: '8px',
              padding: '5px 10px',
              backgroundColor: '#34a853',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Copy to Clipboard
          </button>
        </div>
      )}
    </div>
  )
}
