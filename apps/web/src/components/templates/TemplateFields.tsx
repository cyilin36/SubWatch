import { useTranslation } from 'react-i18next';
import { SECRET_KEEP, type TemplateField } from '@subwatch/shared';
import { Field, Input, SecretInput, Select, Switch, Textarea } from '../ui';
import { templateValueToText } from '../../lib/templates';

export interface TemplateFieldsProps {
  fields: TemplateField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** Per-parameter messages keyed by field key (from the render endpoint). */
  fieldErrors?: Record<string, string[]>;
  idPrefix?: string;
  disabled?: boolean;
  className?: string;
}

function isWideField(field: TemplateField): boolean {
  return field.type === 'textarea' || field.type === 'json';
}

/**
 * Dynamic parameter form rendered from a template's `TemplateField[]`. Shared by
 * the "create from template" cards and the subscription edit form.
 */
export function TemplateFields({
  fields,
  values,
  onChange,
  fieldErrors,
  idPrefix = 'template-field',
  disabled = false,
  className,
}: TemplateFieldsProps) {
  const { t } = useTranslation();
  if (fields.length === 0) return null;

  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${className ?? ''}`}>
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const error = fieldErrors?.[field.key]?.[0];
        const value = values[field.key];
        const textValue = templateValueToText(field.type, value);

        let control: React.ReactNode;
        switch (field.type) {
          case 'textarea':
            control = (
              <Textarea
                id={id}
                rows={3}
                value={textValue}
                placeholder={field.placeholder || undefined}
                invalid={Boolean(error)}
                disabled={disabled}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
            break;
          case 'json':
            control = (
              <Textarea
                id={id}
                rows={4}
                value={textValue}
                placeholder={field.placeholder || '{}'}
                invalid={Boolean(error)}
                disabled={disabled}
                className="font-mono text-xs"
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
            break;
          case 'number':
            control = (
              <Input
                id={id}
                type="number"
                step="any"
                min={field.min}
                max={field.max}
                value={textValue}
                placeholder={field.placeholder || undefined}
                invalid={Boolean(error)}
                disabled={disabled}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
            break;
          case 'date':
            control = (
              <Input
                id={id}
                type="date"
                value={textValue}
                invalid={Boolean(error)}
                disabled={disabled}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
            break;
          case 'time':
            control = (
              <Input
                id={id}
                type="time"
                step={60}
                value={textValue}
                invalid={Boolean(error)}
                disabled={disabled}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
            break;
          case 'select':
            control = (
              <Select
                id={id}
                value={textValue || undefined}
                placeholder={field.placeholder || t('templates.apply.selectValue')}
                disabled={disabled}
                invalid={Boolean(error)}
                onValueChange={(next) => onChange(field.key, next)}
                options={field.options.map((option) => ({ value: option.value, label: option.label }))}
              />
            );
            break;
          case 'switch':
            control = (
              <div className="flex h-9 items-center">
                <Switch
                  id={id}
                  checked={value === true}
                  disabled={disabled}
                  ariaLabel={field.label}
                  onCheckedChange={(checked) => onChange(field.key, checked)}
                />
              </div>
            );
            break;
          case 'secret':
            control = (
              <SecretInput
                id={id}
                value={textValue}
                hasStoredValue={value === SECRET_KEEP}
                placeholder={field.placeholder || t('templates.apply.secretPlaceholder')}
                invalid={Boolean(error)}
                disabled={disabled}
                onChange={(next) => onChange(field.key, next)}
              />
            );
            break;
          case 'url':
          case 'text':
          default:
            control = (
              <Input
                id={id}
                type={field.type === 'url' ? 'url' : 'text'}
                value={textValue}
                placeholder={field.placeholder || undefined}
                invalid={Boolean(error)}
                disabled={disabled}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
            break;
        }

        return (
          <Field
            key={field.key}
            label={field.label || field.key}
            htmlFor={id}
            hint={field.help || undefined}
            error={error}
            required={field.required}
            className={isWideField(field) ? 'sm:col-span-2' : undefined}
          >
            {control}
          </Field>
        );
      })}
    </div>
  );
}
