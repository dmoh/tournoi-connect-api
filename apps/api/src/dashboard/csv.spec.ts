import { describe, expect, it } from 'vitest';
import { csvCell, euros, toCsv } from './csv.js';

describe('CSV', () => {
  it('protège les séparateurs, guillemets et retours à la ligne', () => {
    expect(csvCell('FC Annecy')).toBe('FC Annecy');
    expect(csvCell('Saint-Pierre; U13')).toBe('"Saint-Pierre; U13"');
    expect(csvCell('Le "Gone"')).toBe('"Le ""Gone"""');
    expect(csvCell('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(7)).toBe('7');
  });

  it('neutralise les formules', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+33 6 12')).toBe("'+33 6 12");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    // Un nombre négatif reste un nombre.
    expect(csvCell(-5)).toBe('-5');
  });

  it('écrit un fichier lisible par Excel', () => {
    const csv = toCsv(['Équipe', 'Total'], [['Les Aigles', euros(1250)]]);
    expect(csv).toBe('﻿Équipe;Total\r\nLes Aigles;12,50\r\n');
  });
});
