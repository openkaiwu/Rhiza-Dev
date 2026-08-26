import { useEffect, useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { presentErrorText } from '../error-presentation';
import 'katex/dist/katex.min.css';

function MermaidBlock({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setError('');
    setSvg('');
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: { primaryColor: '#e4f0eb', primaryTextColor: '#20231f', primaryBorderColor: '#2d7567', lineColor: '#6c8176', secondaryColor: '#f5f6f1', tertiaryColor: '#ffffff', fontFamily: 'Manrope, Microsoft YaHei, sans-serif' } });
      return mermaid.render(`rhiza-mermaid-${id}`, chart);
    }).then(result => {
      if (!disposed) setSvg(result.svg);
    }).catch(renderError => {
      if (!disposed) setError(presentErrorText(renderError, { message: '流程图无法渲染。', recovery: '请检查 Mermaid 语法后重试。' }));
    });
    return () => { disposed = true; };
  }, [chart, id]);

  if (error) return <div className="mermaid-error" role="img" aria-label="流程图渲染失败"><span>Mermaid</span><p>流程图语法无法解析：{error}</p><code>{chart}</code></div>;
  if (!svg) return <div className="mermaid-loading" role="status">正在绘制流程图…</div>;
  return <div className="mermaid-block" role="img" aria-label="Mermaid 流程图" dangerouslySetInnerHTML={{ __html: svg }} />;
}

const markdownComponents: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h4>{children}</h4>,
  h3: ({ children }) => <h5>{children}</h5>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  code: ({ className, children, ...props }) => {
    const language = /language-(\w+)/.exec(className || '')?.[1];
    if (language === 'mermaid') return <MermaidBlock chart={String(children).replace(/\n$/, '')} />;
    return <code className={className} {...props}>{children}</code>;
  },
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (child && typeof child === 'object' && 'type' in child && child.type === MermaidBlock) return <>{children}</>;
    return <pre>{children}</pre>;
  },
  table: ({ children }) => <div className="markdown-table-wrap"><table>{children}</table></div>,
  input: ({ checked, ...props }) => <input type="checkbox" checked={checked || false} readOnly {...props}/>,
};

export function MarkdownRenderer({ content }: { content: string }) {
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>{content}</ReactMarkdown></div>;
}
