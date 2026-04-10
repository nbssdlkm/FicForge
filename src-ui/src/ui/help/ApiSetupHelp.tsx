// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { useTranslation } from "../../i18n/useAppTranslation";
import { Modal } from "../shared/Modal";

interface ApiSetupHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ApiSetupHelp({ isOpen, onClose }: ApiSetupHelpProps) {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("help.apiSetup.title")}>
      <div className="space-y-6 text-sm text-text/80">
        {/* What is API Key */}
        <section>
          <h3 className="mb-2 text-base font-bold text-text">{t("help.apiSetup.whatIsKey")}</h3>
          <p className="leading-relaxed">{t("help.apiSetup.whatIsKeyDesc")}</p>
        </section>

        {/* Model name */}
        <section>
          <h3 className="mb-2 text-base font-bold text-text">{t("help.apiSetup.modelTitle")}</h3>
          <p className="leading-relaxed">{t("help.apiSetup.modelDesc")}</p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-black/10 bg-surface/50 dark:border-white/10">
                <th className="px-3 py-2 text-left">{t("help.apiSetup.provider")}</th>
                <th className="px-3 py-2 text-left">{t("help.apiSetup.writingModel")}</th>
                <th className="px-3 py-2 text-left">Embedding</th>
              </tr></thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                <tr><td className="px-3 py-2">DeepSeek</td><td className="px-3 py-2 font-mono">deepseek-chat</td><td className="px-3 py-2">—</td></tr>
                <tr><td className="px-3 py-2">OpenAI</td><td className="px-3 py-2 font-mono">gpt-4o-mini</td><td className="px-3 py-2 font-mono">text-embedding-3-small</td></tr>
                <tr><td className="px-3 py-2">{t("help.apiSetup.siliconflow")}</td><td className="px-3 py-2 font-mono">deepseek-ai/DeepSeek-V3</td><td className="px-3 py-2 font-mono">BAAI/bge-m3</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Base URL */}
        <section>
          <h3 className="mb-2 text-base font-bold text-text">{t("help.apiSetup.urlTitle")}</h3>
          <div className="mt-2 space-y-1 rounded-lg bg-surface/50 p-3 text-xs font-mono">
            <p>DeepSeek: https://api.deepseek.com</p>
            <p>OpenAI: https://api.openai.com/v1</p>
            <p>{t("help.apiSetup.siliconflow")}: https://api.siliconflow.cn/v1</p>
            <p>Ollama: http://localhost:11434/v1</p>
          </div>
        </section>

        {/* How to get key */}
        <section>
          <h3 className="mb-2 text-base font-bold text-text">{t("help.apiSetup.howToGetKey")}</h3>
          <div className="space-y-3">
            <div>
              <p className="font-medium">DeepSeek</p>
              <p className="text-xs text-text/60">{t("help.apiSetup.deepseekSteps")}</p>
            </div>
            <div>
              <p className="font-medium">OpenAI</p>
              <p className="text-xs text-text/60">{t("help.apiSetup.openaiSteps")}</p>
            </div>
            <div>
              <p className="font-medium">{t("help.apiSetup.siliconflow")}</p>
              <p className="text-xs text-text/60">{t("help.apiSetup.siliconflowSteps")}</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section>
          <h3 className="mb-2 text-base font-bold text-text">{t("help.apiSetup.faqTitle")}</h3>
          <div className="space-y-3 text-xs">
            <div>
              <p className="font-medium">{t("help.apiSetup.faqTestFail")}</p>
              <p className="text-text/60">{t("help.apiSetup.faqTestFailAnswer")}</p>
            </div>
            <div>
              <p className="font-medium">{t("help.apiSetup.faqSafe")}</p>
              <p className="text-text/60">{t("help.apiSetup.faqSafeAnswer")}</p>
            </div>
            <div>
              <p className="font-medium">{t("help.apiSetup.faqFree")}</p>
              <p className="text-text/60">{t("help.apiSetup.faqFreeAnswer")}</p>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
