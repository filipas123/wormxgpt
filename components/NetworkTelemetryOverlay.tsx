import React from 'react';
import { TelemetryStreamOverlay } from './TelemetryStreamOverlay';

export interface NetworkTelemetryOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NetworkTelemetryOverlay: React.FC<NetworkTelemetryOverlayProps> = (props) => {
  return <TelemetryStreamOverlay {...props} />;
};

export default NetworkTelemetryOverlay;
