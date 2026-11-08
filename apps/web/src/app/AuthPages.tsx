import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setCsrf } from '../lib/api.js';
import { useI18n } from '../i18n/index.js';
import { Button, ErrorNote, Field, Input, Panel } from '../components/ui.js';
import { LanguageSwitch } from './Shell.js';

export function SetupPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({ username: '', displayName: '', workspaceName: '', password: '', confirm: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = f.confirm.length > 0 && f.confirm !== f.password;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ csrfToken: string }>('/auth/setup', { username: f.username, password: f.password, ...(f.displayName ? { displayName: f.displayName } : {}), ...(f.workspaceName ? { workspaceName: f.workspaceName } : {}) });
      setCsrf(r.csrfToken);
      await qc.invalidateQueries();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title={t('auth.setupTitle')} help={t('auth.setupHelp')}>
      <form onSubmit={submit} className="grid gap-3" data-testid="setup-form">
        <Field label={t('auth.username')}>{(id) => <Input id={id} autoComplete="username" required minLength={3} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} data-testid="setup-username" />}</Field>
        <Field label={t('auth.displayName')}>{(id) => <Input id={id} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}</Field>
        <Field label={t('auth.workspaceName')}>{(id) => <Input id={id} value={f.workspaceName} onChange={(e) => setF({ ...f, workspaceName: e.target.value })} />}</Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}>{(id) => <Input id={id} type="password" autoComplete="new-password" required minLength={12} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="setup-password" />}</Field>
        <Field label={t('auth.confirm')} error={mismatch ? t('auth.mismatch') : null}>{(id) => <Input id={id} type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} data-testid="setup-confirm" />}</Field>
        <ErrorNote error={err} />
        <Button type="submit" variant="primary" disabled={busy || mismatch} data-testid="setup-submit">{t('auth.setupSubmit')}</Button>
      </form>
    </AuthFrame>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ csrfToken: string }>('/auth/login', f);
      setCsrf(r.csrfToken);
      await qc.invalidateQueries();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title={t('auth.loginTitle')}>
      <form onSubmit={submit} className="grid gap-3" data-testid="login-form">
        <Field label={t('auth.username')}>{(id) => <Input id={id} autoComplete="username" required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} data-testid="login-username" />}</Field>
        <Field label={t('auth.password')}>{(id) => <Input id={id} type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="login-password" />}</Field>
        <ErrorNote error={err} />
        <Button type="submit" variant="primary" disabled={busy} data-testid="login-submit">{t('auth.loginSubmit')}</Button>
      </form>
    </AuthFrame>
  );
}

function AuthFrame({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="grid min-h-full place-items-center bg-night p-4">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between text-white">
          <div>
            <p className="pixel-heading text-lg">{t('app.name')}</p>
            <p className="text-xs text-surface-3">{t('app.tagline')}</p>
          </div>
          <LanguageSwitch dark />
        </div>
        <Panel title={title}>
          {help ? <p className="mb-3 text-sm text-ink-soft">{help}</p> : null}
          {children}
        </Panel>
      </div>
    </main>
  );
}
