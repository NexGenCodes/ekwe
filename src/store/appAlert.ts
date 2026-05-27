import { observable } from '@legendapp/state';
import { AlertButton } from 'react-native';

export type AlertType = 'info' | 'success' | 'error' | 'confirm';

export interface AppAlertState {
  isVisible: boolean;
  type: AlertType;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  cancelable?: boolean;
}

const defaultState: AppAlertState = {
  isVisible: false,
  type: 'info',
  title: '',
  message: undefined,
  buttons: undefined,
  cancelable: true,
};

// Global observable state for the custom AppAlert UI
export const appAlert$ = observable<AppAlertState>(defaultState);

export const appAlertActions = {
  show: (params: Omit<AppAlertState, 'isVisible'>): void => {
    appAlert$.set({
      ...params,
      isVisible: true,
    });
  },
  hide: (): void => {
    appAlert$.isVisible.set(false);
    // We do not clear the title/message immediately so the exit animation doesn't snap to empty text
  },
};
