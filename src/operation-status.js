export const OperationStatus = Object.freeze({
  WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  RETRYABLE: 'RETRYABLE',
  FAILED_FINAL: 'FAILED_FINAL',
  UNKNOWN: 'UNKNOWN',
  PREVIEW: 'PREVIEW',
});

const RUNNING = new Set(['ACCEPTED', 'QUEUED', 'PENDING', 'RUNNING', 'PROCESSING', 'IN_PROGRESS']);
const SUCCEEDED = new Set(['OK', 'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'APPLIED', 'PUBLISHED', 'DELIVERED']);
const RETRYABLE = new Set(['RETRY', 'RETRYABLE', 'RETRY_PENDING']);
const FAILED = new Set(['ERROR', 'FAILED', 'FAILED_FINAL', 'REJECTED', 'CANCELLED', 'CANCELED']);

export function operationSucceeded({ tool, operationId, result }) {
  const operation = result?.operation && typeof result.operation === 'object'
    ? result.operation
    : result;
  const status = normalizeStatus(operation?.state || operation?.operationStatus || operation?.status);
  const resolvedId = operation?.operationId || operationId;
  const retryable = operation?.safeToRetry === true || operation?.retryable === true || status === OperationStatus.RETRYABLE;
  return {
    operationId: resolvedId,
    status,
    retryable,
    nextAction: operation?.nextAction || nextActionFor(status, retryable, resolvedId),
    tool: tool.name,
    result,
  };
}

export function operationAwaitingConfirmation({ tool, operationId }) {
  return {
    operationId,
    status: OperationStatus.WAITING_CONFIRMATION,
    retryable: false,
    nextAction: `Explicit user confirmation is required. Ask the user to approve this exact ${tool.name} operation, then call it again with _confirmed=true and the same _idempotencyKey=${operationId}.`,
    tool: tool.name,
  };
}

export function operationFailed({ tool, operationId, error }) {
  const operation = error?.details?.operation || error?.details || {};
  const httpStatus = operation.httpStatus || operation.statusCode || error?.statusCode;
  const retryable = operation.safeToRetry === true || operation.retryable === true || isRetryableHttp(httpStatus);
  const status = normalizeStatus(operation.state, retryable ? OperationStatus.RETRYABLE : OperationStatus.FAILED_FINAL);
  const resolvedId = operation.operationId || operationId;
  return {
    operationId: resolvedId,
    status,
    retryable: status === OperationStatus.UNKNOWN ? false : retryable,
    nextAction: operation.nextAction || nextActionFor(status, retryable, resolvedId),
    tool: tool.name,
    error: {
      code: operation.code || error?.name || 'ToolError',
      message: error?.message || 'Operation failed',
      ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    },
  };
}

export function operationIsError(receipt) {
  return [OperationStatus.RETRYABLE, OperationStatus.FAILED_FINAL, OperationStatus.UNKNOWN].includes(receipt?.status);
}

export function isWriteTool(tool) {
  return tool?.mode === 'WRITE' || tool?.annotations?.readOnlyHint === false;
}

function normalizeStatus(raw, fallback = OperationStatus.SUCCEEDED) {
  const status = String(raw || '').toUpperCase();
  if (Object.values(OperationStatus).includes(status)) return status;
  if (RUNNING.has(status)) return OperationStatus.RUNNING;
  if (SUCCEEDED.has(status)) return OperationStatus.SUCCEEDED;
  if (RETRYABLE.has(status)) return OperationStatus.RETRYABLE;
  if (FAILED.has(status)) return OperationStatus.FAILED_FINAL;
  return fallback;
}

function nextActionFor(status, retryable, operationId) {
  if (status === OperationStatus.UNKNOWN) {
    return `Query operation.get_status or operation.get_timeline for ${operationId}; do not automatically retry or create a new key.`;
  }
  if (retryable || status === OperationStatus.RETRYABLE) {
    return `Retry with the same idempotency key ${operationId} after the advised delay.`;
  }
  switch (status) {
    case OperationStatus.RUNNING:
      return `Poll operation.get_status with operationId ${operationId}.`;
    case OperationStatus.WAITING_CONFIRMATION:
      return 'Obtain explicit user confirmation before continuing.';
    case OperationStatus.FAILED_FINAL:
      return 'Inspect the error and correct the request; use a new key only for a changed intent.';
    case OperationStatus.PREVIEW:
      return 'Review the preview and obtain confirmation before executing the write.';
    default:
      return 'No further action is required.';
  }
}

function isRetryableHttp(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}
