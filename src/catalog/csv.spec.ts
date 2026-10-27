import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('separa filas y columnas', () => {
    expect(parseCsv('name,price\nLatte,55')).toEqual([
      ['name', 'price'],
      ['Latte', '55'],
    ]);
  });

  it('respeta comas dentro de comillas', () => {
    expect(parseCsv('name,price\n"Latte, grande",70')).toEqual([
      ['name', 'price'],
      ['Latte, grande', '70'],
    ]);
  });

  it('desescapa comillas dobles', () => {
    expect(parseCsv('name\n"Latte ""especial"""')).toEqual([
      ['name'],
      ['Latte "especial"'],
    ]);
  });

  it('acepta saltos de línea dentro de un campo entre comillas', () => {
    expect(parseCsv('description\n"Línea 1\nLínea 2"')).toEqual([
      ['description'],
      ['Línea 1\nLínea 2'],
    ]);
  });

  it('tolera BOM, CRLF y líneas vacías', () => {
    expect(parseCsv('\uFEFFname,price\r\nLatte,55\r\n\r\n')).toEqual([
      ['name', 'price'],
      ['Latte', '55'],
    ]);
  });

  it('lee la última fila sin salto de línea final', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('conserva campos vacíos intermedios', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });
});
