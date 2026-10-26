import {
  Atom, BadgeDollarSign, Banknote, BarChart3, BookOpen, Box, Briefcase, Building2, Calendar, Camera,
  ChefHat, Code, CodeXml, Coffee, Compass, Cpu, Database, FileText, Flag, Flame, Folder, Gem, Gift,
  Globe, GraduationCap, Hammer, Handshake, Hash, Heart, HeartPulse, Home, Inbox, Key, Landmark, Layers,
  Leaf, Lightbulb, Mail, Map, Megaphone, MessageCircle, Mic, Music, Package, Palette, PenTool, Phone,
  PiggyBank, Plane, Puzzle, Rocket, Scale, Scissors, Shield, ShoppingBag, ShoppingCart, Sparkles, Star,
  Store, Sun, Target, Truck, Users, Utensils, Wallet, Wrench, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Icons people can pick for an area, a folder or a company logo.
 * Keys are lucide names (the same names pen.dev uses) so they can be stored.
 */
export const ICONS: Record<string, LucideIcon> = {
  hash: Hash, 'code-xml': CodeXml, code: Code, megaphone: Megaphone, briefcase: Briefcase,
  'building-2': Building2, store: Store, 'shopping-bag': ShoppingBag, 'shopping-cart': ShoppingCart,
  package: Package, truck: Truck, wallet: Wallet, banknote: Banknote, 'piggy-bank': PiggyBank,
  'badge-dollar-sign': BadgeDollarSign, landmark: Landmark, scale: Scale, handshake: Handshake,
  users: Users, 'heart-pulse': HeartPulse, heart: Heart, 'graduation-cap': GraduationCap,
  'book-open': BookOpen, 'file-text': FileText, folder: Folder, inbox: Inbox, mail: Mail,
  phone: Phone, 'message-circle': MessageCircle, mic: Mic, camera: Camera, music: Music,
  palette: Palette, 'pen-tool': PenTool, scissors: Scissors, wrench: Wrench, hammer: Hammer,
  cpu: Cpu, database: Database, shield: Shield, key: Key, globe: Globe, map: Map, compass: Compass,
  plane: Plane, home: Home, coffee: Coffee, utensils: Utensils, 'chef-hat': ChefHat, leaf: Leaf,
  sun: Sun, flame: Flame, zap: Zap, rocket: Rocket, target: Target, flag: Flag, star: Star,
  sparkles: Sparkles, gem: Gem, gift: Gift, lightbulb: Lightbulb, puzzle: Puzzle, atom: Atom,
  layers: Layers, calendar: Calendar, 'bar-chart-3': BarChart3, box: Box,
}

export type IconKey = keyof typeof ICONS

/** Colour swatches — the pen palette (neutral + helper accents), as plain hex so tints can be derived. */
export const SWATCHES: string[] = [
  '#78716C', // stone (General)
  '#14B8A6', // teal (Dev)
  '#0EA5E9', // sky (Ops)
  '#6366F1', // indigo (Brand)
  '#8B5CF6', // violet (Sales)
  '#EC4899', // pink (Support)
  '#EF4444', // red
  '#F97316', // orange (Marketing)
  '#EB6834', // company orange
  '#F59E0B', // amber (Spark)
  '#65A30D', // lime (Finance)
  '#64748B', // slate (Retro)
]
