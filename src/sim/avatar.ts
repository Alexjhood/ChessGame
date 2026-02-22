export type AvatarHairStyle = 'Short' | 'Bob' | 'Curly' | 'Spiky';
export type AvatarGender = 'male' | 'female';

export interface AvatarProfile {
  name: string;
  gender: AvatarGender;
  skinTone: string;
  hairColor: string;
  hairStyle: AvatarHairStyle;
  glasses: boolean;
}

export const AVATAR_SKIN_TONES = ['#F6D6B8', '#E8BC96', '#D99D72', '#B97855', '#8D5A3B'];
export const AVATAR_HAIR_COLORS = ['#4B2D1A', '#8A5626', '#2D2C2C', '#A6382D', '#F2C94C', '#5C3AA3'];
export const AVATAR_HAIR_STYLES: AvatarHairStyle[] = ['Short', 'Bob', 'Curly', 'Spiky'];

export const DEFAULT_AVATAR: AvatarProfile = {
  name: 'Rooki',
  gender: 'male',
  skinTone: AVATAR_SKIN_TONES[0]!,
  hairColor: AVATAR_HAIR_COLORS[0]!,
  hairStyle: 'Short',
  glasses: false
};
