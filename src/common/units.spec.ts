import { BadRequestException } from '@nestjs/common';
import { Prisma, UnitCode } from '@prisma/client';
import {
  convertQuantity,
  isUnitCode,
  toMoney,
  toQuantity,
  unitDefinition,
} from './units';

describe('unidades', () => {
  it('convierte dentro de la misma dimensión (kg → g)', () => {
    expect(convertQuantity('0.75', UnitCode.KG, UnitCode.G).toString()).toBe(
      '750',
    );
  });

  it('convierte a una unidad mayor redondeando a 4 decimales', () => {
    expect(convertQuantity(750, UnitCode.ML, UnitCode.L).toString()).toBe(
      '0.75',
    );
    expect(convertQuantity('1.23456', UnitCode.G, UnitCode.KG).toString()).toBe(
      '0.0012',
    );
  });

  it('mantiene la cantidad con 4 decimales si la unidad es la misma', () => {
    expect(convertQuantity('2.123456', UnitCode.G, UnitCode.G).toString()).toBe(
      '2.1235',
    );
  });

  it('rechaza convertir entre dimensiones sin equivalencia', () => {
    expect(() => convertQuantity(1, UnitCode.G, UnitCode.ML)).toThrow(
      BadRequestException,
    );
    expect(() => convertQuantity(1, UnitCode.UNIT, UnitCode.G)).toThrow(
      /equivalencia/,
    );
  });

  it('expone dimensión y factor de cada unidad', () => {
    expect(unitDefinition(UnitCode.KG)).toMatchObject({
      dimension: 'MASS',
      factor: '1000',
    });
    expect(unitDefinition(UnitCode.ML)).toMatchObject({
      dimension: 'VOLUME',
      factor: '1',
    });
    expect(unitDefinition(UnitCode.UNIT)).toMatchObject({
      dimension: 'COUNT',
      label: 'pieza',
    });
    expect(unitDefinition(UnitCode.TSP)).toMatchObject({
      dimension: 'VOLUME',
      factor: '5',
    });
  });

  it('isUnitCode filtra valores desconocidos', () => {
    expect(isUnitCode('KG')).toBe(true);
    expect(isUnitCode('kg')).toBe(false);
    expect(isUnitCode(undefined)).toBe(false);
    expect(isUnitCode('TSP')).toBe(true);
    expect(isUnitCode('POUND')).toBe(false);
  });

  it('toQuantity normaliza a la escala de la base de datos', () => {
    expect(toQuantity('1.23456').toString()).toBe('1.2346');
    expect(toQuantity(2).toString()).toBe('2');
  });

  it('toMoney redondea a 2 decimales', () => {
    expect(toMoney('12.345').toString()).toBe('12.35');
    expect(toMoney(new Prisma.Decimal('0.005')).toString()).toBe('0.01');
  });
});
