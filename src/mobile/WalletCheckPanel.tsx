import { ActionButton } from './ActionButton';
import { AddressField, Body, Dialog, Notice } from './Interface';

export function WalletCheckPanel({ visible, wallet, busy, message, onCheck, onClose }: {
  visible: boolean; wallet: string; busy: boolean; message: string; onCheck: () => void; onClose: () => void;
}) {
  return <Dialog visible={visible} title="Wallet signature check" onClose={busy ? undefined : onClose}>
    <Body>Sign a memo transaction and verify the signature locally. Nothing is sent, and no network fee is paid.</Body>
    <AddressField label="Wallet" value={wallet} />
    {!!message && <Notice>{message}</Notice>}
    <ActionButton title="Sign memo without sending" disabled={busy} onPress={onCheck} />
  </Dialog>;
}
