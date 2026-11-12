// ============================================
// The map on the campaign page, in one of two views
//
// Top-down (MapCanvas) is the full table: fog, lighting, walls and the DM's
// tools. Tactical (TacticalMapCanvas) draws the same map on a diamond grid
// with tile heights. Each viewer picks their own view.
//
// The tactical view does not draw fog or dynamic lighting yet, so a player
// is offered it only on a map with neither: on any other map the top-down
// view is the one that hides what they may not see. The DM sees everything
// in either view and may always switch.
// ============================================

import { lazy, useEffect, useState } from 'react';
import { Box, Map as MapIcon } from 'lucide-react';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import Button from '@/components/ui/Button';
import type { CampaignMap, Token } from '@/types';
import { isHeightGrid, type HeightGrid } from './map/iso/heightGrid';
import TurnBar from './TurnBar';

const MapCanvas = lazy(() => import('@/components/campaign/MapCanvas'));
const TacticalMapCanvas = lazy(() => import('@/components/campaign/TacticalMapCanvas'));

/** Whether this viewer may be shown the tactical view of a map. */
export function tacticalViewAllowed(
  map: Pick<CampaignMap, 'fogEnabled' | 'lightingEnabled'> | null,
  role: string | null | undefined
): boolean {
  if (!map) return false;
  if (role === 'DM') return true;
  // Fog absent on an older payload means on, as everywhere else.
  return (map.fogEnabled ?? true) === false && !map.lightingEnabled;
}

interface MapViewProps {
  onEditToken?: (token: Token) => void;
}

export default function MapView({ onEditToken }: MapViewProps) {
  const { currentMap, setCurrentMap, userRole } = useCampaign();
  const { socket } = useWebSocket();
  const [wantsTactical, setWantsTactical] = useState(false);

  const allowed = tacticalViewAllowed(currentMap, userRole);
  const tactical = wantsTactical && allowed;

  // Heights change under either view, so they are taken in here, where the
  // listener outlives a switch between the two.
  useEffect(() => {
    const io = socket?.getSocket();
    if (!io) return;
    const onHeights = (data: { mapId: string; tileHeights: HeightGrid | null }) => {
      const tileHeights = isHeightGrid(data.tileHeights) ? data.tileHeights : null;
      setCurrentMap((latest) =>
        latest && latest.id === data.mapId ? { ...latest, tileHeights } : latest
      );
    };
    io.on('heights:replaced', onHeights);
    return () => {
      io.off('heights:replaced', onHeights);
    };
  }, [socket, setCurrentMap]);

  return (
    <div className="relative w-full h-full">
      {tactical ? <TacticalMapCanvas /> : <MapCanvas onEditToken={onEditToken} />}
      {currentMap && <TurnBar />}
      {currentMap && allowed && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 glass-panel p-1 bg-parchment/90 backdrop-blur-xs">
          <Button
            variant="ghost"
            size="sm"
            icon={tactical ? MapIcon : Box}
            aria-pressed={tactical}
            title={tactical ? 'Switch to the top-down view' : 'Switch to the tactical view'}
            onClick={() => setWantsTactical((current) => !current)}
          >
            {tactical ? 'Top-down view' : 'Tactical view'}
          </Button>
        </div>
      )}
    </div>
  );
}
