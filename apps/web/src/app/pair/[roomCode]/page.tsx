import { notFound } from 'next/navigation';
import { ROOM_CODE_PATTERN } from '@bchu/shared';
import { PairPhotobooth } from '@/features/pair/PairPhotobooth';

/**
 * A malformed code never reaches the room UI. A well-formed code that this tab
 * did not join is handled inside the component, which sends the person back to
 * the lobby instead of creating a room implicitly.
 */
export default async function PairRoomPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = await params;
  const normalized = decodeURIComponent(roomCode).toUpperCase();

  if (!ROOM_CODE_PATTERN.test(normalized)) notFound();

  return <PairPhotobooth code={normalized} />;
}
