import { onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useI18n } from '../../i18n/context';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog(props: Props) {
  const { t } = useI18n();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onCancel();
    if (e.key === 'Enter') props.onConfirm();
  };
  document.addEventListener('keydown', onKeyDown);
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  return (
    <Portal>
      <div class="confirm-backdrop" onClick={props.onCancel}>
        <div class="confirm-dialog" onClick={e => e.stopPropagation()}>
          <p class="confirm-message">{props.message}</p>
          <div class="confirm-actions">
            <button class="confirm-btn" onClick={props.onCancel}>{t('cancel')}</button>
            <button class="confirm-btn danger" onClick={props.onConfirm}>{t('delete')}</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
