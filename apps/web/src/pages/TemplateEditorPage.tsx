import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  LayoutTemplate,
  Plus,
  Save,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  sampleTemplateValues,
  templateInputSchema,
  type TemplateDto,
  type TemplateFieldType,
  type TemplateKind,
} from '@subwatch/shared';
import { api, type TemplateInput } from '../lib/api';
import {
  blankTemplateFieldDraft,
  buildTemplateExamplePayload,
  draftToTemplateField,
  fieldTypeSupportsTextConstraints,
  parseOptionsText,
  summarizeTemplateError,
  summarizeZodError,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_KINDS,
  templateFieldToDraft,
  templateFieldTypeLabelKey,
  templateKindLabelKey,
  type TemplateFieldDraft,
} from '../lib/templates';
import { errorMessage } from '../lib/utils';
import {
  Alert,
  Badge,
  Button,
  ErrorState,
  Field,
  FullPageSpinner,
  Input,
  PageHeader,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '../components/ui';
import { CodeEditor } from '../components/ui/CodeEditor';
import { FormSection, JsonPreview, Segmented } from '../components/common/fields';
import { TemplateFields } from '../components/templates/TemplateFields';

type EditorTab = 'basic' | 'fields' | 'payload';

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export function TemplateEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const initialKind: TemplateKind = new URLSearchParams(location.search).get('kind') === 'monitor'
    ? 'monitor'
    : 'subscription';

  const templateQuery = useQuery({
    queryKey: ['template', id],
    queryFn: () => api.templates.get(id ?? ''),
    enabled: Boolean(id),
  });

  if (id) {
    if (templateQuery.isPending) {
      return (
        <div>
          <PageHeader label={t('nav.templates')} title={t('templates.editTemplate')} />
          <FullPageSpinner label={t('common.loading')} />
        </div>
      );
    }
    if (templateQuery.isError || !templateQuery.data) {
      return (
        <div>
          <PageHeader label={t('nav.templates')} title={t('templates.editTemplate')} />
          <ErrorState error={templateQuery.error} onRetry={() => void templateQuery.refetch()} />
        </div>
      );
    }
  }

  return (
    <TemplateEditorContent
      key={templateQuery.data?.id ?? 'new'}
      template={templateQuery.data}
      initialKind={initialKind}
      onBack={() => navigate('/templates')}
    />
  );
}

// ---------------------------------------------------------------------------
// Editor content
// ---------------------------------------------------------------------------

interface TemplateEditorContentProps {
  template?: TemplateDto;
  initialKind: TemplateKind;
  onBack: () => void;
}

function payloadErrorText(text: string, t: (key: string) => string): string | null {
  if (text.trim() === '') return t('templates.editor.payload.empty');
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return t('templates.editor.payload.objectRequired');
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function parsePayloadObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  return parsed as Record<string, unknown>;
}

function TemplateEditorContent({ template, initialKind, onBack }: TemplateEditorContentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isCreate = !template;
  const [tab, setTab] = useState<EditorTab>('basic');
  const [kind, setKind] = useState<TemplateKind>(template?.kind ?? initialKind);
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [icon, setIcon] = useState(template?.icon ?? '');
  const [color, setColor] = useState(template?.color ?? '');
  const [category, setCategory] = useState(template?.category ?? '');
  const [fields, setFields] = useState<TemplateFieldDraft[]>(
    template ? template.fields.map(templateFieldToDraft) : [],
  );
  const [payloadText, setPayloadText] = useState(
    template ? `${JSON.stringify(template.payload, null, 2)}\n` : '{}\n',
  );
  const [issues, setIssues] = useState<string[]>([]);

  const kindTemplatesQuery = useQuery({
    queryKey: ['templates', kind],
    queryFn: () => api.templates.list(kind),
  });

  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const summary of kindTemplatesQuery.data ?? []) {
      if (summary.category) values.add(summary.category);
      if (summary.id === template?.id && template.category) values.add(template.category);
    }
    if (template?.category) values.add(template.category);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [kindTemplatesQuery.data, template]);

  const payloadIssue = payloadErrorText(payloadText, t);

  const draftRefs = useMemo(
    () =>
      fields
        .filter((draft) => draft.key.trim() !== '')
        .map((draft) => ({ key: draft.key.trim(), type: draft.type })),
    [fields],
  );

  const saveMutation = useMutation({
    mutationFn: (input: TemplateInput) =>
      template ? api.templates.update(template.id, input) : api.templates.create(input),
    onSuccess: (saved) => {
      toast.success(
        isCreate
          ? t('templates.editor.createSuccess')
          : t('templates.editor.updateSuccess'),
      );
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      void queryClient.invalidateQueries({ queryKey: ['template', saved.id] });
      setIssues([]);
      if (isCreate) navigate(`/templates/${saved.id}`, { replace: true });
    },
    onError: (error) => {
      const summary = summarizeTemplateError(error);
      setIssues(summary.messages);
      toast.error(t('templates.editor.saveFailed'), { description: errorMessage(error) });
    },
  });

  const updateField = (index: number, patch: Partial<TemplateFieldDraft>) => {
    setFields((current) => current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)));
  };

  const moveField = (index: number, delta: number) => {
    setFields((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const [entry] = next.splice(index, 1);
      next.splice(target, 0, entry as TemplateFieldDraft);
      return next;
    });
  };

  const insertExample = () => {
    const example = buildTemplateExamplePayload(kind, draftRefs);
    setPayloadText(`${JSON.stringify(example, null, 2)}\n`);
    setIssues([]);
  };

  const handleSave = () => {
    if (payloadIssue) {
      setIssues([payloadIssue]);
      toast.error(t('errors.validation'));
      return;
    }
    const parsed = templateInputSchema.safeParse({
      kind,
      name: name.trim(),
      description,
      icon: icon.trim(),
      color: color.trim(),
      category: category.trim(),
      fields: fields.map(draftToTemplateField),
      payload: parsePayloadObject(payloadText),
    });
    if (!parsed.success) {
      setIssues(summarizeZodError(parsed.error));
      toast.error(t('errors.validation'));
      return;
    }
    setIssues([]);
    saveMutation.mutate(parsed.data);
  };

  return (
    <div>
      <PageHeader
        label={t('nav.templates')}
        title={isCreate ? t('templates.newTemplate') : t('templates.editTemplate')}
        description={isCreate ? t('templates.editor.subtitleCreate') : template.name}
        icon={<LayoutTemplate className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('templates.list.backToList')}
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="min-w-0 space-y-6">
          <Tabs value={tab} onValueChange={(value) => setTab(value as EditorTab)}>
            <TabsList className="sm:w-auto">
              <TabsTrigger value="basic">{t('templates.editor.basicInfo')}</TabsTrigger>
              <TabsTrigger value="fields">
                {t('templates.editor.fields.title')}
                <span className="rounded-pill bg-white/10 px-1.5 py-0.5 text-[10px] leading-none text-moonlight">
                  {fields.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="payload">{t('templates.editor.payload.title')}</TabsTrigger>
            </TabsList>

            <TabsContent value="basic">
              <FormSection description={t('templates.editor.basicHint')}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t('common.name')}
                    htmlFor="template-name"
                    required
                    className="sm:col-span-2"
                  >
                    <Input
                      id="template-name"
                      value={name}
                      maxLength={100}
                      placeholder={t('templates.editor.namePlaceholder')}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>

                  <Field
                    label={t('templates.editor.kind')}
                    hint={isCreate ? undefined : t('templates.editor.kindFixedHint')}
                  >
                    {isCreate ? (
                      <Segmented
                        value={kind}
                        onChange={setKind}
                        options={TEMPLATE_KINDS.map((entry) => ({
                          value: entry,
                          label: t(templateKindLabelKey(entry)),
                        }))}
                      />
                    ) : (
                      <Badge tone="info">{t(templateKindLabelKey(kind))}</Badge>
                    )}
                  </Field>

                  <Field label={t('templates.editor.icon')} htmlFor="template-icon" hint={t('templates.editor.iconHint')}>
                    <Input
                      id="template-icon"
                      value={icon}
                      maxLength={16}
                      placeholder="🔔"
                      onChange={(event) => setIcon(event.target.value)}
                    />
                  </Field>

                  <Field label={t('templates.editor.color')} htmlFor="template-color" hint={t('templates.editor.colorHint')}>
                    <div className="flex items-center gap-2">
                      <Input
                        id="template-color"
                        value={color}
                        maxLength={20}
                        placeholder="#RRGGBB"
                        className="font-mono"
                        onChange={(event) => setColor(event.target.value)}
                      />
                      <span
                        className="glass-flat h-10 w-10 shrink-0"
                        style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : 'transparent' }}
                        aria-hidden
                      />
                    </div>
                  </Field>

                  <Field label={t('templates.editor.category')} htmlFor="template-category">
                    <Input
                      id="template-category"
                      value={category}
                      maxLength={50}
                      list="template-categories"
                      placeholder={t('templates.editor.categoryPlaceholder')}
                      onChange={(event) => setCategory(event.target.value)}
                    />
                    <datalist id="template-categories">
                      {categories.map((entry) => (
                        <option key={entry} value={entry} />
                      ))}
                    </datalist>
                  </Field>

                  <Field
                    label={t('common.description')}
                    htmlFor="template-description"
                    className="sm:col-span-2"
                  >
                    <Textarea
                      id="template-description"
                      rows={2}
                      maxLength={500}
                      value={description}
                      placeholder={t('templates.editor.descriptionPlaceholder')}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </Field>
                </div>
              </FormSection>
            </TabsContent>

            <TabsContent value="fields">
              <FormSection description={t('templates.editor.fields.hint')}>
                {fields.length === 0 ? (
                  <div className="glass-flat flex flex-col items-center px-6 py-8 text-center">
                    <LayoutTemplate className="h-6 w-6 text-moon-steel" aria-hidden />
                    <p className="mt-3 text-body font-medium text-white/85">
                      {t('templates.editor.fields.empty')}
                    </p>
                    <p className="mt-1 text-xs text-moon-steel">{t('templates.editor.fields.emptyHint')}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {fields.map((draft, index) => (
                      <TemplateFieldRow
                        key={index}
                        index={index}
                        draft={draft}
                        canMoveUp={index > 0}
                        canMoveDown={index < fields.length - 1}
                        onChange={(patch) => updateField(index, patch)}
                        onMove={(delta) => moveField(index, delta)}
                        onRemove={() => setFields((current) => current.filter((_entry, position) => position !== index))}
                      />
                    ))}
                  </div>
                )}
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFields((current) => [...current, blankTemplateFieldDraft()])}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {t('templates.editor.fields.add')}
                  </Button>
                </div>
              </FormSection>
            </TabsContent>

            <TabsContent value="payload">
              <FormSection description={t('templates.editor.payload.hint')}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="type-label">{t('templates.editor.payload.placeholders')}</span>
                    {draftRefs.length === 0 ? (
                      <span className="text-xs text-moon-steel">
                        {t('templates.editor.payload.noPlaceholders')}
                      </span>
                    ) : (
                      draftRefs.map((ref) => (
                        <code
                          key={ref.key}
                          className="rounded-pill border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-moonlight"
                        >
                          {`{{${ref.key}}}`}
                        </code>
                      ))
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={insertExample}>
                    <Wand2 className="h-3.5 w-3.5" aria-hidden />
                    {t('templates.editor.payload.example')}
                  </Button>
                </div>
                <CodeEditor
                  value={payloadText}
                  onChange={setPayloadText}
                  language="json"
                  height="300px"
                  placeholder={t('templates.editor.payload.placeholder')}
                />
                {payloadIssue ? <p className="text-xs text-danger">{payloadIssue}</p> : null}
              </FormSection>
            </TabsContent>
          </Tabs>

          {issues.length > 0 ? (
            <Alert tone="danger" title={t('templates.editor.issuesTitle')}>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {issues.slice(0, 12).map((issue, index) => (
                  <li key={index} className="break-words">
                    {issue}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <div className="glass flex flex-wrap items-center justify-end gap-2 p-3">
            <Button variant="outline" onClick={onBack}>
              {t('common.cancel')}
            </Button>
            <Button loading={saveMutation.isPending} onClick={handleSave}>
              <Save className="h-4 w-4" aria-hidden />
              {isCreate ? t('templates.editor.create') : t('templates.editor.save')}
            </Button>
          </div>
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:self-start">
          <TemplateTestRenderPanel template={template} />
          <Alert tone="info">{t('templates.editor.testPanel.rateLimitHint')}</Alert>
          <Alert tone="warning">{t('templates.editor.securityHint')}</Alert>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field row editor
// ---------------------------------------------------------------------------

interface TemplateFieldRowProps {
  index: number;
  draft: TemplateFieldDraft;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (patch: Partial<TemplateFieldDraft>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

const NO_DEFAULT = 'none';

function TemplateFieldRow({
  index,
  draft,
  canMoveUp,
  canMoveDown,
  onChange,
  onMove,
  onRemove,
}: TemplateFieldRowProps) {
  const { t } = useTranslation();
  const textConstraints = fieldTypeSupportsTextConstraints(draft.type);
  const selectOptions = parseOptionsText(draft.optionsText);
  const idPrefix = `template-field-${index}`;

  let defaultControl: React.ReactNode;
  switch (draft.type) {
    case 'secret':
      defaultControl = (
        <Input value="" disabled placeholder={t('templates.editor.fields.secretNoDefault')} />
      );
      break;
    case 'switch':
      defaultControl = (
        <Select
          value={draft.defaultValue === '' ? NO_DEFAULT : draft.defaultValue}
          onValueChange={(value) => onChange({ defaultValue: value === NO_DEFAULT ? '' : value })}
          options={[
            { value: NO_DEFAULT, label: t('templates.editor.fields.noDefault') },
            { value: 'true', label: t('common.yes') },
            { value: 'false', label: t('common.no') },
          ]}
        />
      );
      break;
    case 'select':
      defaultControl = (
        <Select
          value={draft.defaultValue === '' ? NO_DEFAULT : draft.defaultValue}
          onValueChange={(value) => onChange({ defaultValue: value === NO_DEFAULT ? '' : value })}
          options={[
            { value: NO_DEFAULT, label: t('templates.editor.fields.noDefault') },
            ...selectOptions.map((option) => ({ value: option.value, label: option.label })),
          ]}
        />
      );
      break;
    case 'number':
      defaultControl = (
        <Input
          type="number"
          step="any"
          value={draft.defaultValue}
          placeholder={t('templates.editor.fields.noDefault')}
          onChange={(event) => onChange({ defaultValue: event.target.value })}
        />
      );
      break;
    case 'date':
      defaultControl = (
        <Input
          type="date"
          value={draft.defaultValue}
          onChange={(event) => onChange({ defaultValue: event.target.value })}
        />
      );
      break;
    case 'time':
      defaultControl = (
        <Input
          type="time"
          step={60}
          value={draft.defaultValue}
          onChange={(event) => onChange({ defaultValue: event.target.value })}
        />
      );
      break;
    case 'json':
      defaultControl = (
        <Textarea
          rows={2}
          value={draft.defaultValue}
          className="font-mono text-xs"
          placeholder={t('templates.editor.fields.jsonDefaultPlaceholder')}
          onChange={(event) => onChange({ defaultValue: event.target.value })}
        />
      );
      break;
    case 'textarea':
      defaultControl = (
        <Textarea
          rows={2}
          value={draft.defaultValue}
          placeholder={t('templates.editor.fields.noDefault')}
          onChange={(event) => onChange({ defaultValue: event.target.value })}
        />
      );
      break;
    default:
      defaultControl = (
        <Input
          value={draft.defaultValue}
          placeholder={t('templates.editor.fields.noDefault')}
          onChange={(event) => onChange({ defaultValue: event.target.value })}
        />
      );
      break;
  }

  return (
    <div className="glass-flat space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-medium text-white">
          {t('templates.editor.fields.fieldIndex', { index: index + 1 })}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('templates.editor.fields.moveUp')}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('templates.editor.fields.moveDown')}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-danger"
            aria-label={t('common.remove')}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px_auto]">
        <Field label={t('templates.editor.fields.key')} htmlFor={`${idPrefix}-key`} required>
          <Input
            id={`${idPrefix}-key`}
            value={draft.key}
            maxLength={50}
            className="font-mono"
            placeholder="serviceName"
            onChange={(event) => onChange({ key: event.target.value })}
          />
        </Field>
        <Field label={t('templates.editor.fields.label')} htmlFor={`${idPrefix}-label`} required>
          <Input
            id={`${idPrefix}-label`}
            value={draft.label}
            maxLength={100}
            placeholder={t('templates.editor.fields.labelPlaceholder')}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </Field>
        <Field label={t('templates.editor.fields.type')} htmlFor={`${idPrefix}-type`}>
          <Select
            id={`${idPrefix}-type`}
            value={draft.type}
            onValueChange={(value) =>
              onChange({
                type: value as TemplateFieldType,
                defaultValue: '',
                optionsText: value === 'select' ? draft.optionsText : '',
                min: '',
                max: '',
                minLength: '',
                maxLength: '',
                pattern: '',
              })
            }
            options={TEMPLATE_FIELD_TYPES.map((type) => ({
              value: type,
              label: t(templateFieldTypeLabelKey(type)),
            }))}
          />
        </Field>
        <div className="flex items-end pb-2">
          <div className="flex items-center gap-2 text-sm text-white/90">
            <Switch
              id={`${idPrefix}-required`}
              checked={draft.required}
              ariaLabel={t('templates.editor.fields.required')}
              onCheckedChange={(checked) => onChange({ required: checked })}
            />
            <label htmlFor={`${idPrefix}-required`} className="cursor-pointer select-none">
              {t('templates.editor.fields.required')}
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {draft.type !== 'switch' ? (
          <Field label={t('templates.editor.fields.placeholder')} htmlFor={`${idPrefix}-placeholder`}>
            <Input
              id={`${idPrefix}-placeholder`}
              value={draft.placeholder}
              maxLength={200}
              placeholder={t('templates.editor.fields.placeholderHint')}
              onChange={(event) => onChange({ placeholder: event.target.value })}
            />
          </Field>
        ) : null}
        <Field label={t('templates.editor.fields.help')} htmlFor={`${idPrefix}-help`}>
          <Input
            id={`${idPrefix}-help`}
            value={draft.help}
            maxLength={500}
            placeholder={t('templates.editor.fields.helpHint')}
            onChange={(event) => onChange({ help: event.target.value })}
          />
        </Field>
        <Field
          label={t('templates.editor.fields.defaultValue')}
          hint={draft.type === 'secret' ? t('templates.editor.fields.secretNoDefaultHint') : undefined}
          className={draft.type === 'json' || draft.type === 'textarea' ? 'sm:col-span-2' : undefined}
        >
          {defaultControl}
        </Field>
      </div>

      {draft.type === 'select' ? (
        <Field label={t('templates.editor.fields.options')} hint={t('templates.editor.fields.optionsHint')}>
          <Textarea
            rows={3}
            value={draft.optionsText}
            className="font-mono text-xs"
            placeholder={'标签=值\n例如：月度=month'}
            onChange={(event) => onChange({ optionsText: event.target.value })}
          />
        </Field>
      ) : null}

      {draft.type === 'number' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('templates.editor.fields.min')} htmlFor={`${idPrefix}-min`}>
            <Input
              id={`${idPrefix}-min`}
              type="number"
              step="any"
              value={draft.min}
              onChange={(event) => onChange({ min: event.target.value })}
            />
          </Field>
          <Field label={t('templates.editor.fields.max')} htmlFor={`${idPrefix}-max`}>
            <Input
              id={`${idPrefix}-max`}
              type="number"
              step="any"
              value={draft.max}
              onChange={(event) => onChange({ max: event.target.value })}
            />
          </Field>
        </div>
      ) : null}

      {textConstraints ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('templates.editor.fields.minLength')} htmlFor={`${idPrefix}-min-length`}>
            <Input
              id={`${idPrefix}-min-length`}
              type="number"
              min={0}
              value={draft.minLength}
              onChange={(event) => onChange({ minLength: event.target.value })}
            />
          </Field>
          <Field label={t('templates.editor.fields.maxLength')} htmlFor={`${idPrefix}-max-length`}>
            <Input
              id={`${idPrefix}-max-length`}
              type="number"
              min={1}
              value={draft.maxLength}
              onChange={(event) => onChange({ maxLength: event.target.value })}
            />
          </Field>
          <Field label={t('templates.editor.fields.pattern')} htmlFor={`${idPrefix}-pattern`}>
            <Input
              id={`${idPrefix}-pattern`}
              value={draft.pattern}
              className="font-mono"
              placeholder="^[a-z]+$"
              onChange={(event) => onChange({ pattern: event.target.value })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test render panel
// ---------------------------------------------------------------------------

function TemplateTestRenderPanel({ template }: { template?: TemplateDto }) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [tab, setTab] = useState<'payload' | 'values'>('payload');

  const fieldKey = template ? template.fields.map((field) => field.key).join(',') : '';

  useEffect(() => {
    if (!template) {
      setValues({});
      return;
    }
    setValues(sampleTemplateValues(template.fields));
    renderMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id, template?.updatedAt, fieldKey]);

  const renderMutation = useMutation({
    mutationFn: () => api.templates.render(template?.id ?? '', values),
    onError: (error) => toast.error(t('templates.editor.testPanel.failed'), { description: errorMessage(error) }),
  });

  if (!template) {
    return (
      <div className="glass-flat p-5">
        <p className="text-body font-medium text-white">{t('templates.editor.testPanel.title')}</p>
        <p className="mt-1.5 text-xs text-moon-steel">{t('templates.editor.testPanel.unsavedHint')}</p>
      </div>
    );
  }

  const errorSummary = renderMutation.error ? summarizeTemplateError(renderMutation.error) : null;

  return (
    <div className="glass-flat p-5">
      <p className="text-body font-medium text-white">{t('templates.editor.testPanel.title')}</p>
      <p className="mt-1 text-xs text-moon-steel">{t('templates.editor.testPanel.hint')}</p>

      <div className="mt-4">
        <TemplateFields
          fields={template.fields}
          values={values}
          fieldErrors={errorSummary?.fieldErrors}
          idPrefix="template-test"
          onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="outline" size="sm" loading={renderMutation.isPending} onClick={() => renderMutation.mutate()}>
          {t('templates.editor.testPanel.run')}
        </Button>
      </div>

      {errorSummary ? (
        <Alert tone="danger" title={t('templates.editor.testPanel.failed')} className="mt-4">
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {errorSummary.messages.map((message, index) => (
              <li key={index} className="break-words">
                {message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {renderMutation.data ? (
        <div className="mt-4">
          <Tabs value={tab} onValueChange={(value) => setTab(value as 'payload' | 'values')}>
            <TabsList>
              <TabsTrigger value="payload">{t('templates.editor.testPanel.renderResult')}</TabsTrigger>
              <TabsTrigger value="values">{t('templates.editor.testPanel.parameterValues')}</TabsTrigger>
            </TabsList>
            <TabsContent value="payload">
              <JsonPreview value={renderMutation.data.payload} />
            </TabsContent>
            <TabsContent value="values">
              <JsonPreview value={renderMutation.data.values} />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <p className="mt-4 text-xs text-moon-steel">{t('templates.editor.testPanel.empty')}</p>
      )}
    </div>
  );
}
