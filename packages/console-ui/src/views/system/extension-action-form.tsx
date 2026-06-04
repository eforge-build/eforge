import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { ExtensionActionBindingManifest, ExtensionActionManifestEntry, ExtensionJsonObject } from './system-types';
import {
  coerceFormValues,
  defaultFieldValue,
  formatJsonPreview,
  mergeInputDefaults,
  schemaEnumValues,
  schemaPropertyKind,
  schemaPropertyNames,
  type InvocationState,
} from './extension-contribution-rendering';

interface ExtensionActionFormProps {
  action?: ExtensionActionManifestEntry;
  binding: ExtensionActionBindingManifest;
  invocation: InvocationState;
  onInvoke: (input: ExtensionJsonObject) => Promise<void> | void;
}

export function ExtensionActionForm({ action, binding, invocation, onInvoke }: ExtensionActionFormProps) {
  const schema = action?.inputSchema ?? { type: 'object', properties: {} };
  const names = schemaPropertyNames(schema);
  const [values, setValues] = React.useState<Record<string, string | boolean>>(() => initialValues(schema, binding.inputDefaults));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function setValue(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const coerced = coerceFormValues(schema, values, binding.inputDefaults);
    setErrors(coerced.errors);
    if (Object.keys(coerced.errors).length > 0) return;
    await onInvoke(mergeInputDefaults(binding, coerced.input));
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      {names.length === 0 ? (
        <p className="text-xs text-muted-foreground">This action does not declare input fields.</p>
      ) : (
        <div className="grid gap-2">
          {names.map((name) => renderField(name, schema, values[name], errors[name], setValue))}
        </div>
      )}
      <Button type="submit" size="sm" disabled={invocation.status === 'running'}>
        {invocation.status === 'running' ? 'Running…' : 'Submit action'}
      </Button>
      <InvocationResult invocation={invocation} />
    </form>
  );
}

function initialValues(schema: unknown, defaults?: ExtensionJsonObject): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  const root = schema as { properties?: Record<string, unknown> };
  for (const name of schemaPropertyNames(schema)) {
    values[name] = defaultFieldValue(defaults, name, root.properties?.[name]);
  }
  return values;
}

function renderField(
  name: string,
  schema: unknown,
  value: string | boolean | undefined,
  error: string | undefined,
  setValue: (name: string, value: string | boolean) => void,
) {
  const root = schema as { properties?: Record<string, unknown> };
  const prop = root.properties?.[name];
  const kind = schemaPropertyKind(prop);
  const id = `extension-action-field-${name}`;
  const common = 'rounded border bg-background px-2 py-1 text-xs';

  return (
    <label key={name} className="grid gap-1 text-xs">
      <span className="font-medium">{name}</span>
      {kind === 'boolean' ? (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => setValue(name, event.currentTarget.checked)}
          className="h-4 w-4"
        />
      ) : kind === 'enum' ? (
        <select
          id={id}
          value={String(value ?? '')}
          onChange={(event) => setValue(name, event.currentTarget.value)}
          className={common}
        >
          <option value="">Select…</option>
          {schemaEnumValues(prop).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : kind === 'json' ? (
        <textarea
          id={id}
          value={String(value ?? '')}
          onChange={(event) => setValue(name, event.currentTarget.value)}
          className={`${common} min-h-20 font-mono`}
        />
      ) : (
        <input
          id={id}
          type={kind === 'number' || kind === 'integer' ? 'number' : 'text'}
          step={kind === 'integer' ? '1' : undefined}
          value={String(value ?? '')}
          onChange={(event) => setValue(name, event.currentTarget.value)}
          className={common}
        />
      )}
      {error && <span className="text-destructive" role="alert">{error}</span>}
    </label>
  );
}

export function InvocationResult({ invocation }: { invocation: InvocationState }) {
  if (invocation.status === 'idle' || invocation.status === 'running') {
    return <p className="text-xs text-muted-foreground" aria-live="polite">{invocation.status === 'running' ? 'Action request running…' : ''}</p>;
  }
  if (invocation.status === 'failure') {
    return (
      <p className="text-xs text-destructive" role="alert" aria-live="polite">
        Action failed{invocation.code ? ` (${invocation.code})` : ''}: {invocation.message}
      </p>
    );
  }
  const preview = formatJsonPreview(invocation.output);
  return (
    <div className="text-xs text-emerald-600" aria-live="polite">
      <p>Action succeeded: {invocation.invocationId}</p>
      {preview && (
        <details className="mt-1">
          <summary className="cursor-pointer">Output preview</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px] text-foreground">{preview}</pre>
        </details>
      )}
    </div>
  );
}
