import type {
  ValidationProviderAnnotation,
  ValidationProviderResult,
} from '../../../packages/extension-sdk/src/index';

const BASELINE_EXCEEDED_PATTERN = /^\s*BASELINE EXCEEDED\s+(.+?):\s+(\d+)\s+lines\s+\(ceiling:\s+(\d+)\)\s*$/gm;
const CAP_EXCEEDED_PATTERN = /^\s*CAP EXCEEDED\s+(.+?):\s+(\d+)\s+lines\s+\((.+?)\s+cap:\s+(\d+)\)\s*$/gm;
const REGION_SECTION_HEADER_PATTERN = /^\s*Region marker balance violations:\s*$/;
const NEXT_SECTION_HEADER_PATTERN = /^\s*File size violations:\s*$/;
const MARKER_VIOLATION_PATTERN = /^\s*(.+?):\s+(.+?)\s*$/;

function fileSizeFixText(): string {
  return 'Reduce the file size by extracting helpers/modules, splitting tests, or removing duplicated structure; do not use comment shortening or dense formatting as the primary repair strategy.';
}

function fileSizeRetryGuidance(path: string): string {
  return `Retry structurally in ${path}: extract cohesive code or split the file while preserving behavior. Do not rely on comment shortening or dense formatting to satisfy the gate.`;
}

function parsePositiveInt(value: string): number {
  return Number.parseInt(value, 10);
}

function buildBaselineAnnotation(match: RegExpExecArray): ValidationProviderAnnotation {
  const [, file, currentLinesText, ceilingText] = match;
  const currentLines = parsePositiveInt(currentLinesText);
  const ceiling = parsePositiveInt(ceilingText);
  const overflow = currentLines - ceiling;

  return {
    severity: 'error',
    file,
    message: `${file} exceeds its maintainability baseline by ${overflow} line${overflow === 1 ? '' : 's'}.`,
    details: match[0].trim(),
    fix: fileSizeFixText(),
    retryGuidance: fileSizeRetryGuidance(file),
    failureKind: 'maintainability:file-size-baseline',
    repairClass: 'structural',
    metadata: {
      thresholdType: 'baseline',
      currentLines,
      ceiling,
      overflow,
    },
  };
}

function buildCapAnnotation(match: RegExpExecArray): ValidationProviderAnnotation {
  const [, file, currentLinesText, category, capText] = match;
  const currentLines = parsePositiveInt(currentLinesText);
  const cap = parsePositiveInt(capText);
  const overflow = currentLines - cap;

  return {
    severity: 'error',
    file,
    message: `${file} exceeds the ${category} file-size cap by ${overflow} line${overflow === 1 ? '' : 's'}.`,
    details: match[0].trim(),
    fix: fileSizeFixText(),
    retryGuidance: fileSizeRetryGuidance(file),
    failureKind: 'maintainability:file-size-cap',
    repairClass: 'structural',
    metadata: {
      thresholdType: 'cap',
      category,
      currentLines,
      cap,
      overflow,
    },
  };
}

function parseFileSizeAnnotations(output: string): ValidationProviderAnnotation[] {
  const annotations: ValidationProviderAnnotation[] = [];

  for (const match of output.matchAll(BASELINE_EXCEEDED_PATTERN)) {
    annotations.push(buildBaselineAnnotation(match));
  }

  for (const match of output.matchAll(CAP_EXCEEDED_PATTERN)) {
    annotations.push(buildCapAnnotation(match));
  }

  return annotations;
}

function markerLineFromMessage(message: string): number | undefined {
  const directLine = message.match(/\bat line\s+(\d+)\b/);
  if (directLine) return parsePositiveInt(directLine[1]);

  const openedLine = message.match(/\bopened at line\s+(\d+)\b/);
  if (openedLine) return parsePositiveInt(openedLine[1]);

  return undefined;
}

function buildMarkerAnnotation(line: string): ValidationProviderAnnotation | undefined {
  const match = line.match(MARKER_VIOLATION_PATTERN);
  if (!match) return undefined;

  const [, file, markerMessage] = match;
  const markerLine = markerLineFromMessage(markerMessage);

  return {
    severity: 'error',
    file,
    ...(markerLine !== undefined ? { line: markerLine } : {}),
    message: `Region marker balance violation in ${file}.`,
    details: line.trim(),
    fix: 'Repair the eforge region markers in this file so every region/endregion pair is balanced and correctly nested.',
    retryGuidance: 'Make a targeted marker-balance repair only; do not refactor unrelated code while fixing region markers.',
    failureKind: 'maintainability:region-marker-balance',
    repairClass: 'narrow',
    metadata: {
      markerMessage,
      ...(markerLine !== undefined ? { markerLine } : {}),
    },
  };
}

function parseRegionMarkerAnnotations(output: string): ValidationProviderAnnotation[] {
  const annotations: ValidationProviderAnnotation[] = [];
  let inRegionSection = false;

  for (const line of output.split(/\r?\n/)) {
    if (REGION_SECTION_HEADER_PATTERN.test(line)) {
      inRegionSection = true;
      continue;
    }

    if (!inRegionSection) continue;
    if (NEXT_SECTION_HEADER_PATTERN.test(line)) break;
    if (line.trim().length === 0) continue;

    const annotation = buildMarkerAnnotation(line);
    if (annotation) annotations.push(annotation);
  }

  return annotations;
}

export function parseMaintainabilityOutput(output: string): ValidationProviderResult {
  const details = output.trim();
  const annotations = [
    ...parseRegionMarkerAnnotations(details),
    ...parseFileSizeAnnotations(details),
  ];

  if (annotations.length === 0) {
    return {
      status: 'failed',
      message: details.length > 0
        ? 'Agent maintainability check failed with unparseable output.'
        : 'Agent maintainability check failed without output.',
      details,
    };
  }

  return {
    status: 'failed',
    message: `Agent maintainability check failed with ${annotations.length} maintainability violation${annotations.length === 1 ? '' : 's'}.`,
    details,
    annotations,
  };
}
