import { ModeSwitch } from './ModeSwitch';
import { MoreEffectsButton } from './MoreEffectsButton';
import { PillButton } from './PillButton';
import { ShutterButton } from './ShutterButton';

/**
 * Bottom of the Solo and Duo windows: mode switch, shutter, effects, download.
 */
export function BoothShelf({
  mode,
  shutterLabel,
  shutterDisabled,
  onShutter,
  downloadLabel,
  downloadDisabled,
  onDownload,
  note,
}: {
  mode: 'solo' | 'duo';
  shutterLabel: string;
  shutterDisabled?: boolean;
  onShutter: () => void;
  downloadLabel: string;
  downloadDisabled?: boolean;
  onDownload: () => void;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ModeSwitch active={mode} />
        <ShutterButton label={shutterLabel} disabled={shutterDisabled} onClick={onShutter} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <MoreEffectsButton />
          <PillButton className="min-h-[29px] px-3 text-sm sm:text-sm" disabled={downloadDisabled} onClick={onDownload}>
            {downloadLabel}
          </PillButton>
        </div>
      </div>
      {note ? <p className="text-center text-sm tracking-[-0.05em]">{note}</p> : null}
    </div>
  );
}
