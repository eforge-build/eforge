/**
 * Config section — config sources, validation result, validation errors, and JSON inspector.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { SystemSection } from './system-section';
import { JsonDetails } from './json-details';
import { selectConfigSourceRows } from '@/lib/selectors';
import type { Loadable, ConfigShowVerboseResponse, ConfigValidateResponse } from './system-types';

interface ConfigSectionProps {
  show: Loadable<ConfigShowVerboseResponse>;
  validate: Loadable<ConfigValidateResponse>;
}

export function ConfigSection({ show, validate }: ConfigSectionProps) {
  const isLoading = show.status === 'loading' || validate.status === 'loading';
  const showError = show.status === 'error' ? show.error : undefined;
  const validateError = validate.status === 'error' ? validate.error : undefined;

  const sourceRows = show.status === 'success' || (show.status === 'error' && show.data)
    ? selectConfigSourceRows(show.data?.sources)
    : [];

  const configFound = validate.status === 'success' ? validate.data.configFound
    : validate.status === 'error' && validate.data ? validate.data.configFound
    : null;

  const validationErrors =
    validate.status === 'success' && !validate.data.valid
      ? (validate.data.errors ?? [])
      : validate.status === 'error' && validate.data && !validate.data.valid
        ? (validate.data.errors ?? [])
        : [];

  const isValid = validate.status === 'success' ? validate.data.valid : null;

  return (
    <SystemSection
      title="Config"
      description="Resolved configuration, source paths, and validation results."
      loading={isLoading}
    >
      {showError && (
        <p className="text-xs text-destructive" role="alert">{showError}</p>
      )}
      {validateError && (
        <p className="text-xs text-destructive" role="alert">{validateError}</p>
      )}

      <div className="space-y-3 text-xs">
        {configFound === false && (
          <p className="text-muted-foreground">No config file found</p>
        )}

        {isValid !== null && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium">Validation</span>
            <Badge variant={isValid ? 'secondary' : 'destructive'}>
              {isValid ? 'valid' : 'invalid'}
            </Badge>
          </div>
        )}

        {validationErrors.length > 0 && (
          <div>
            <p className="text-muted-foreground font-medium mb-1">Validation errors</p>
            <ul className="space-y-1">
              {validationErrors.map((err, i) => (
                <li key={i} className="text-destructive pl-2 border-l border-destructive/30">
                  {err}
                </li>
              ))}
            </ul>
          </div>
        )}

        {sourceRows.length > 0 && (
          <div>
            <p className="text-muted-foreground font-medium mb-1">Config sources</p>
            <dl className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1">
              {sourceRows.map((row) => (
                <React.Fragment key={row.scope}>
                  <dt className="text-muted-foreground capitalize">{row.scope}</dt>
                  <dd className="font-mono break-all">{row.path ?? '-'}</dd>
                  <dd>
                    <Badge variant={row.found ? 'secondary' : 'outline'} className="text-xs">
                      {row.found ? 'found' : 'not found'}
                    </Badge>
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}

        {(show.status === 'success' || (show.status === 'error' && show.data)) && show.data?.resolved != null && (
          <JsonDetails label="Resolved config (JSON)" value={show.data.resolved} />
        )}
      </div>
    </SystemSection>
  );
}
