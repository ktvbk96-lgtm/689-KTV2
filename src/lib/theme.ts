import { AppThemeId } from '../types';

export interface ThemeConfig {
  id: AppThemeId;
  nameLao: string;
  nameEn: string;
  description: string;
  bgClass: string;
  cardBgClass: string;
  accentGradient: string;
  accentText: string;
  borderAccent: string;
  previewBg: string;
  previewAccent: string;
}

export const THEMES: Record<AppThemeId, ThemeConfig> = {
  neon_ktv: {
    id: 'neon_ktv',
    nameLao: 'ໂທນ Neon KTV (ມາດຕະຖານ)',
    nameEn: 'Electric Neon KTV',
    description: 'ສີມຶດສະເໜ່ Slate 950 ຕັດດ້ວຍ Rose Neon & ທອງຄຳ Amber',
    bgClass: 'bg-slate-950 text-slate-100',
    cardBgClass: 'bg-slate-900 border-slate-800',
    accentGradient: 'from-rose-500 via-rose-600 to-amber-500',
    accentText: 'text-rose-400',
    borderAccent: 'border-rose-500',
    previewBg: '#090d16',
    previewAccent: '#f43f5e',
  },
  sapphire_blue: {
    id: 'sapphire_blue',
    nameLao: 'ໂທນ Sapphire Night (ຟ້າຄາມໄພລິນ)',
    nameEn: 'Sapphire Night Club',
    description: 'ໂທນສີຟ້າຄາມເລິກ Navy ຕັດດ້ວຍຟ້າສະຫວ່າງ Cyan & Ice Blue',
    bgClass: 'bg-[#040b17] text-slate-100',
    cardBgClass: 'bg-[#08152b] border-[#132c57]',
    accentGradient: 'from-blue-600 via-cyan-500 to-sky-400',
    accentText: 'text-cyan-400',
    borderAccent: 'border-cyan-500',
    previewBg: '#040b17',
    previewAccent: '#06b6d4',
  },
  royal_purple: {
    id: 'royal_purple',
    nameLao: 'ໂທນ Royal Velvet (ມ່ວງສະຫງ່າ VIP)',
    nameEn: 'Royal Velvet VIP',
    description: 'ໂທນສີມ່ວງຄຳ VIP Lounge ຕັດດ້ວຍສີບົວ Fuchsia & Violet Neon',
    bgClass: 'bg-[#0e071a] text-slate-100',
    cardBgClass: 'bg-[#180e2d] border-[#2f1b58]',
    accentGradient: 'from-purple-600 via-fuchsia-600 to-pink-500',
    accentText: 'text-purple-400',
    borderAccent: 'border-purple-500',
    previewBg: '#0e071a',
    previewAccent: '#a855f7',
  },
  emerald_luxury: {
    id: 'emerald_luxury',
    nameLao: 'ໂທນ Emerald Lounge (ຂຽວມໍລະກົດຫລູຫລາ)',
    nameEn: 'Emerald Lounge Club',
    description: 'ໂທນສີຂຽວມໍລະກົດ VIP Club ຕັດດ້ວຍສີຂຽວ Mint & Champagne Gold',
    bgClass: 'bg-[#03130d] text-slate-100',
    cardBgClass: 'bg-[#092218] border-[#134431]',
    accentGradient: 'from-emerald-600 via-teal-500 to-amber-400',
    accentText: 'text-emerald-400',
    borderAccent: 'border-emerald-500',
    previewBg: '#03130d',
    previewAccent: '#10b981',
  },
  amber_gold: {
    id: 'amber_gold',
    nameLao: 'ໂທນ Golden Bourbon (ທອງຄຳບາຣ໌ຄລາດສິກ)',
    nameEn: 'Golden Bourbon Bar',
    description: 'ໂທນສີທອງຄຳອົບອຸ່ນ Whiskey & Classic Cocktail Bar',
    bgClass: 'bg-[#120a04] text-slate-100',
    cardBgClass: 'bg-[#211409] border-[#442811]',
    accentGradient: 'from-amber-500 via-yellow-500 to-orange-500',
    accentText: 'text-amber-400',
    borderAccent: 'border-amber-500',
    previewBg: '#120a04',
    previewAccent: '#f59e0b',
  },
  midnight_black: {
    id: 'midnight_black',
    nameLao: 'ໂທນ Pure Midnight (ດຳມຶດ OLED)',
    nameEn: 'Pure Midnight OLED',
    description: 'ໂທນສີດຳລ້ວນ True Black ປະຢັດແບັດເຕີຣີໜ້າຈໍ OLED ຄົມຊັດ',
    bgClass: 'bg-[#000000] text-gray-100',
    cardBgClass: 'bg-[#101010] border-[#222222]',
    accentGradient: 'from-rose-600 via-red-600 to-zinc-400',
    accentText: 'text-rose-400',
    borderAccent: 'border-zinc-700',
    previewBg: '#000000',
    previewAccent: '#e11d48',
  },
};

export const getThemeConfig = (themeId?: AppThemeId): ThemeConfig => {
  return THEMES[themeId || 'neon_ktv'] || THEMES.neon_ktv;
};
