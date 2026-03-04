import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  Alert,
  AlertGroup,
  AlertVariant,
  AlertActionCloseButton,
} from '@patternfly/react-core';

interface AlertItem {
  key: number;
  title: string;
  variant: AlertVariant;
}

interface AlertContextType {
  addAlert: (title: string, variant: AlertVariant) => void;
  addSuccessAlert: (title: string) => void;
  addDangerAlert: (title: string) => void;
  addWarningAlert: (title: string) => void;
  addInfoAlert: (title: string) => void;
}

const AlertContext = createContext<AlertContextType>({
  addAlert: () => {},
  addSuccessAlert: () => {},
  addDangerAlert: () => {},
  addWarningAlert: () => {},
  addInfoAlert: () => {},
});

export const useAlerts = () => useContext(AlertContext);

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const counterRef = useRef(0);

  const removeAlert = useCallback((key: number) => {
    setAlerts(prev => prev.filter(a => a.key !== key));
  }, []);

  const addAlert = useCallback((title: string, variant: AlertVariant) => {
    const key = counterRef.current++;
    setAlerts(prev => [...prev, { key, title, variant }]);
    setTimeout(() => removeAlert(key), 5000);
  }, [removeAlert]);

  const addSuccessAlert = useCallback((title: string) => addAlert(title, AlertVariant.success), [addAlert]);
  const addDangerAlert = useCallback((title: string) => addAlert(title, AlertVariant.danger), [addAlert]);
  const addWarningAlert = useCallback((title: string) => addAlert(title, AlertVariant.warning), [addAlert]);
  const addInfoAlert = useCallback((title: string) => addAlert(title, AlertVariant.info), [addAlert]);

  return (
    <AlertContext.Provider value={{ addAlert, addSuccessAlert, addDangerAlert, addWarningAlert, addInfoAlert }}>
      {children}
      <AlertGroup isToast isLiveRegion>
        {alerts.map(({ key, title, variant }) => (
          <Alert
            key={key}
            variant={variant}
            title={title}
            timeout={5000}
            actionClose={<AlertActionCloseButton onClose={() => removeAlert(key)} />}
          />
        ))}
      </AlertGroup>
    </AlertContext.Provider>
  );
};
