import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { useAuth } from '../../providers/AuthProvider';
import { cn } from '../../lib/utils';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  language?: 'javascript' | 'json' | 'text';
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

/** Thin CodeMirror wrapper used for JS extractors and webhook body templates. */
export function CodeEditor({
  value,
  onChange,
  height = '260px',
  language = 'javascript',
  placeholder,
  readOnly = false,
  className,
}: CodeEditorProps) {
  const { resolvedTheme } = useAuth();
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] [&_.cm-editor]:text-[13px] [&_.cm-editor.cm-focused]:outline-none',
        className,
      )}
    >
      <CodeMirror
        value={value}
        height={height}
        theme={resolvedTheme}
        readOnly={readOnly}
        placeholder={placeholder}
        extensions={language === 'javascript' ? [javascript()] : []}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: true,
          bracketMatching: true,
        }}
        onChange={onChange}
      />
    </div>
  );
}
