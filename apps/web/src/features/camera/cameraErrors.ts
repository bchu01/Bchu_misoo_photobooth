/** Maps raw getUserMedia failures onto distinct, actionable messages. */

export type CameraErrorKind =
  | 'unsupported'
  | 'insecure-context'
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'overconstrained'
  | 'unknown';

export interface CameraFailure {
  kind: CameraErrorKind;
  message: string;
  /** False when retrying cannot possibly help. */
  retryable: boolean;
}

const FAILURES: Record<CameraErrorKind, Omit<CameraFailure, 'kind'>> = {
  unsupported: {
    message:
      'This browser does not support camera access. Try the latest Chrome, Edge, Firefox, or Safari.',
    retryable: false,
  },
  'insecure-context': {
    message:
      'Camera access needs a secure connection. Open this page over https:// (or on localhost).',
    retryable: false,
  },
  denied: {
    message:
      'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.',
    retryable: true,
  },
  'not-found': {
    message: 'No camera was found on this device.',
    retryable: true,
  },
  'in-use': {
    message:
      'The camera is being used by another app or tab. Close it and try again.',
    retryable: true,
  },
  overconstrained: {
    message: 'That camera could not be started. Pick a different camera and try again.',
    retryable: true,
  },
  unknown: {
    message: 'The camera could not be started. Try again.',
    retryable: true,
  },
};

export function describeCameraFailure(kind: CameraErrorKind): CameraFailure {
  return { kind, ...FAILURES[kind] };
}

export function classifyCameraError(error: unknown): CameraFailure {
  if (!(error instanceof Error)) return describeCameraFailure('unknown');

  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return describeCameraFailure('denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return describeCameraFailure('not-found');
    case 'NotReadableError':
    case 'TrackStartError':
      return describeCameraFailure('in-use');
    case 'OverconstrainedError':
      return describeCameraFailure('overconstrained');
    default:
      return describeCameraFailure('unknown');
  }
}
