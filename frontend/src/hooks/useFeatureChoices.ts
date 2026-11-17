import { useEffect, useState } from 'react';
import type { DndFeatureChoice } from '@/types';
import api from '@/services/api';

const EMPTY: DndFeatureChoice[] = [];

/**
 * The options features make a character choose, as the campaign's rules list
 * them, for the sheet editor to offer. Empty while loading, for a character
 * in no campaign, and for a campaign that is not set to D&D 5e: the editor
 * then shows a feature's name to type, as it always has.
 */
export function useFeatureChoices(campaignId: string | null | undefined): DndFeatureChoice[] {
  const [choices, setChoices] = useState<DndFeatureChoice[]>(EMPTY);
  useEffect(() => {
    let current = true;
    setChoices(EMPTY);
    if (!campaignId) return;
    Promise.resolve()
      .then(() => api.getDndRules(campaignId))
      .then((catalogue) => {
        if (current) setChoices(catalogue?.featureChoices ?? EMPTY);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [campaignId]);
  return choices;
}
