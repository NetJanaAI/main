import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: {
          "convospan_sys": "CONVOSPAN [SYS]",
          "global_intel_net": "GLOBAL_INTEL_NET",
          "auth_node": "Auth_Node",
          "initialize_sys": "Initialize_SYS",
          "launch_terminal": "Launch_Terminal",
          "system_telemetry": "SYSTEM_TELEMETRY",
          "sync_active": "SYNC_ACTIVE",
          "sys_id": "SYS_ID",
          "target_organization": "TARGET_ORGANIZATION",
          "detected_intent_vector": "DETECTED_INTENT_VECTOR",
          "confidence_score": "CONFiDENCE_SCORE",
          "stat": "STAT",
          "node_dxb_core_04": "NODE: DXB_CORE_04",
          "protocol_doc": "Protocol_Doc",
          "privacy_guard": "Privacy_Guard",
          "compliance": "Compliance"
        }
      }
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // react already safes from xss
    }
  });

export default i18n;
