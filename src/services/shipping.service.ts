import { getSupabaseClient } from './db.service';

interface OlvaCotizacion {
  estado: boolean;
  costo: string;
  peso_exceso: number;
  servicio: string;
}

export async function cotizarOlva(params: {
  origenDepartamento: string;
  origenProvincia: string;
  origenDistrito: string;
  destinoDepartamento: string;
  destinoProvincia: string;
  destinoDistrito: string;
  recojo: 'TDA' | 'REG';
  tipo: 'Paquetes' | 'Sobres';
  pesoKg: number;
  anchoCm: number;
  largoCm: number;
  altoCm: number;
}): Promise<OlvaCotizacion | null> {
  const formData = new URLSearchParams({
    'HddPartner': '0',
    'encuentras-departamento': params.origenDepartamento,
    'encuentras-provincia': params.origenProvincia,
    'encuentras-distrito': params.origenDistrito,
    'llevamos-departamento': params.destinoDepartamento,
    'llevamos-provincia': params.destinoProvincia,
    'llevamos-distrito': params.destinoDistrito,
    'recojo': params.recojo,
    'que': params.tipo,
    // Ensure peso relies on string parsing of integer/decimal if Olva mandates so
    'pesa': params.pesoKg.toString(),
    'ancho': params.anchoCm.toString(),
    'largo': params.largoCm.toString(),
    'alto': params.altoCm.toString(),
  });

  try {
    const response = await fetch('https://www.olvacourier.com/cotizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });
    return await response.json();
  } catch (error) {
    console.error('Error cotizando con Olva:', error);
    return null;
  }
}

export async function getProvinciasOlva(departmentId: string) {
  try {
    if (departmentId === '15') {
       return [
          { id: '1501', provincia: 'Lima' },
          { id: '1502', provincia: 'Barranca' },
          { id: '1503', provincia: 'Cajatambo' },
          { id: '1504', provincia: 'Canta' },
          { id: '1505', provincia: 'Cañete' },
          { id: '1506', provincia: 'Huaral' },
          { id: '1507', provincia: 'Huarochirí' },
          { id: '1508', provincia: 'Huaura' },
          { id: '1509', provincia: 'Oyón' },
          { id: '1510', provincia: 'Yauyos' }
       ];
    }
    const response = await fetch(`https://www.olvacourier.com/api/provincias?department_id=${departmentId}`);
    return await response.json();
  } catch (error) {
    console.error('Error obteniendo provincias:', error);
    return [];
  }
}

export async function getDistritosOlva(provinceId: string) {
  try {
    if (provinceId === '1501') {
       return [
          { id: '150101', name: 'Lima Cercado' },
          { id: '150105', name: 'Breña' },
          { id: '150117', name: 'Los Olivos' },
          { id: '150122', name: 'Miraflores' },
          { id: '150131', name: 'San Isidro' },
          { id: '150132', name: 'San Juan de Lurigancho' },
          { id: '150140', name: 'Santiago de Surco' },
          { id: '150141', name: 'Surquillo' }
       ];
    }
    const response = await fetch(`https://www.olvacourier.com/api/distritos?province_id=${provinceId}`);
    return await response.json();
  } catch (error) {
    console.error('Error obteniendo distritos:', error);
    return [];
  }
}

interface ShalomCotizacion {
  precio: number;
  tamano_paquete: string;
  peso_exceso_kg: number;
  recargo_peso: number;
  lead_time: string;
  agencias_destino: Array<{id: number, nombre: string, precio: number}>;
}

export async function cotizarShalom(params: {
  origenId: number;
  destinoTexto: string;
  pesoTotalKg: number;
  largoCm?: number;
  anchoCm?: number;
  altoCm?: number;
}): Promise<ShalomCotizacion | null> {
  let pesoCalculo = params.pesoTotalKg;
  if (params.largoCm && params.anchoCm && params.altoCm) {
    const pesoVolumetrico = (params.largoCm * params.anchoCm * params.altoCm) / 6000;
    if (pesoVolumetrico > pesoCalculo) {
      pesoCalculo = pesoVolumetrico;
    }
  }

  let tamano: string;
  let campoPrecio: string;
  if (pesoCalculo <= 0.25) { tamano = 'xxs'; campoPrecio = 'precio_xxs'; }
  else if (pesoCalculo <= 0.5) { tamano = 'xs'; campoPrecio = 'precio_xs'; }
  else if (pesoCalculo <= 2) { tamano = 's'; campoPrecio = 'precio_s'; }
  else if (pesoCalculo <= 5) { tamano = 'm'; campoPrecio = 'precio_m'; }
  else { tamano = 'l'; campoPrecio = 'precio_l'; }

  try {
    const supabase = getSupabaseClient();
    
    // shalom_tariffs should return results grouped by destination agency or just 1 record for destination province/district.
    const { data: results, error } = await supabase
      .from('shalom_tariffs')
      .select('*')
      .eq('origen_id', params.origenId)
      .ilike('destino_nombre', `%${params.destinoTexto}%`);

    if (error || !results || results.length === 0) {
      console.warn(`No Shalom results found for origenId=${params.origenId} desc=${params.destinoTexto}`);
      return null;
    }

    const agenciasDestino = [];
    let minPrice: number | null = null;
    const minLeadTime = results[0]?.lead_time || '';
    
    for (const row of results) {
       let currPrice = Number(row[campoPrecio]) || 0;
       
       if (pesoCalculo > 10) {
         const aditionalWeight = pesoCalculo - 10;
         currPrice += aditionalWeight * (Number(row['precio_por_kilo']) || 0);
       }
       
       if (minPrice === null || currPrice < minPrice) {
         minPrice = currPrice;
       }

       agenciasDestino.push({
         id: row.destino_id || row.id, 
         nombre: row.destino_nombre || row.nombre, 
         precio: currPrice
       });
    }

    return {
      precio: minPrice || 0,
      tamano_paquete: tamano,
      peso_exceso_kg: Math.max(0, pesoCalculo - 10),
      recargo_peso: (pesoCalculo > 10) ? ((pesoCalculo - 10) * (Number(results[0]['precio_por_kilo']) || 0)) : 0,
      lead_time: minLeadTime,
      agencias_destino: agenciasDestino
    };
  } catch (error) {
    console.error('Error cotizando con Shalom:', error);
    return null;
  }
}

export async function buscarAgenciasShalom(texto: string): Promise<Array<{id: number, nombre: string}>> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('shalom_agencies')
      .select('id, nombre')
      .ilike('nombre', `%${texto}%`)
      .order('nombre', { ascending: true })
      .limit(20);
      
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error buscando agencias Shalom:', error);
    return [];
  }
}

// Shipping config is stored inside the existing `operacion` JSONB column under
// the `shippingConfig` key, alongside `metodos_pago`. This avoids needing a new
// top-level column (which would require an ALTER TABLE + Supabase schema-cache
// refresh) and matches the fallback path bot-manager.ts already expected.
export async function getShippingConfig(botId: string) {
  try {
    const supa = getSupabaseClient();
    const { data, error } = await supa
      .from('bot_configs')
      .select('operacion')
      .eq('id', botId)
      .maybeSingle();
    if (error) {
      console.error('[getShippingConfig] supabase error:', error.message);
      return null;
    }
    // Shipping config lives inside operacion JSONB under `shippingConfig`.
    // Support both the camelCase key (canonical, written by saveShippingConfig)
    // and a snake_case variant for legacy robustness.
    return data?.operacion?.shippingConfig
        || data?.operacion?.shipping_config
        || null;
  } catch (error) {
    console.error('Error obteniendo config de envíos:', error);
    return null;
  }
}

export async function saveShippingConfig(botId: string, config: any) {
  try {
    const supa = getSupabaseClient();
    // Read current operacion so we can merge (don't clobber metodos_pago).
    const { data: current, error: readErr } = await supa
      .from('bot_configs')
      .select('operacion')
      .eq('id', botId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const operacion = {
      ...(current?.operacion || {}),
      shippingConfig: { ...config, updated_at: new Date().toISOString() }
    };
    const { error } = await supa
      .from('bot_configs')
      .update({ operacion })
      .eq('id', botId);
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error('Error al guardar shipping_config:', error);
    throw error;
  }
}
