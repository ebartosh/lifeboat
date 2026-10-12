import { ActionButton } from './ActionButton';
import { AddressField, Dialog, Note, Notice } from './Interface';

export function WalletCheckPanel({ visible, wallet, busy, message, onCheck, onClose }: {
  visible: boolean; wallet: string; busy: boolean; message: string; onCheck: () => void; onClose: () => void;
}) {
  return <Dialog visible={visible} title="Wallet signature check" onClose={busy ? undefined : onClose}
    actions={<ActionButton title="Sign memo without sending" variant="primary" disabled={busy} onPress={onCheck} />}>
    <Note>Sign a memo transaction and verify the signature locally. Nothing is sent, and no network fee is paid.</Note>
    <AddressField label="Wallet" value={wallet} />
    {!!message && <Notice>{message}</Notice>}
  </Dialog>;
}
