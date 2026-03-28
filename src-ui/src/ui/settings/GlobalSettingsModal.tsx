import { useState, useEffect } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { getSettings, updateSettings } from '../../api/settings';

export const GlobalSettingsModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  
  const [settings, setSettings] = useState<any>(null);

  // Form states
  const [model, setModel] = useState('deepseek-chat');
  const [apiBase, setApiBase] = useState('https://api.deepseek.com');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      getSettings().then(res => {
        setSettings(res);
        if (res?.default_llm) {
          setModel(res.default_llm.model || 'deepseek-chat');
          setApiBase(res.default_llm.api_base || 'https://api.deepseek.com');
          setApiKey(res.default_llm.api_key || '');
        }
      }).catch(e => {
        console.error("Failed to load settings", e);
      }).finally(() => setLoading(false));
    } else {
      setTestStatus('idle');
      setTestMessage('');
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const newSettings = {
        ...settings,
        default_llm: {
          ...settings.default_llm,
          model,
          api_base: apiBase,
          api_key: apiKey
        }
      };
      await updateSettings('./fandoms', newSettings);
      onClose();
    } catch (e: any) {
      alert("保存失败：" + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      // Basic Frontend CORS-allowed OpenAI format test
      // Depending on the API provider, some block preflight, but let's attempt it
      const url = apiBase.endsWith('/') ? `${apiBase}v1/models` : `${apiBase}/v1/models`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (res.ok) {
        setTestStatus('success');
        setTestMessage('连接成功！API Key 有效。');
      } else {
         const err = await res.json().catch(() => ({}));
         throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      setTestStatus('error');
      setTestMessage(`连接失败: ${e.message}。请检查 API Base 或 Key 是否正确，或存在网络/跨域问题。`);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="全局系统设置 (Global Settings)">
      {loading ? (
        <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <div className="space-y-6 mt-4">
          <div className="p-4 bg-info/10 text-info text-sm rounded-lg border border-info/20 leading-relaxed font-sans">
            此处的 API Key 与模型配置将在所有 AU 中**默认生效**。如果 AU 没有独立指定模型，系统将回退使用此处的凭证。
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">默认模型 (Default Model)</label>
              <Input value={model} onChange={e => setModel(e.target.value)} placeholder="如: deepseek-chat" />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">API Base URL</label>
              <Input value={apiBase} onChange={e => setApiBase(e.target.value)} placeholder="如: https://api.deepseek.com" />
              <p className="text-xs text-text/50">支持 OpenAI 兼容格式。如果不需要包含 `/v1`，直接填写 Host 即可。</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-text/90">API Key</label>
              <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <div className="flex-1 flex items-center pr-4">
               {testStatus === 'testing' && <span className="text-xs text-text/60 flex items-center"><Loader2 size={14} className="animate-spin mr-1"/> 正在测试...</span>}
               {testStatus === 'success' && <span className="text-xs text-success flex items-center"><CheckCircle2 size={14} className="mr-1"/> {testMessage}</span>}
               {testStatus === 'error' && <span className="text-xs text-error flex items-start"><XCircle size={14} className="mr-1 shrink-0 mt-0.5"/> <span className="leading-tight">{testMessage}</span></span>}
            </div>
            <Button variant="secondary" size="sm" onClick={handleTest} disabled={testStatus === 'testing' || !apiKey.trim()}>
              测试连接
            </Button>
          </div>

          <div className="border-t border-black/10 dark:border-white/10 pt-5 flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving} className="w-32">
              {saving ? <Loader2 size={16} className="animate-spin" /> : "保存全局配置"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
