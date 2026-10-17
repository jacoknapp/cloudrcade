/* Taken from mpeg2decode */
/* Copyright (C) 1996, MPEG Software Simulation Group. All Rights Reserved. */

#include <math.h>
#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#endif
#include "PtrMacro.h"
#include "idct/IEEE1180.h"

#ifndef PI
#	ifdef M_PI
#		define PI M_PI
#	else
#		define PI 3.14159265358979323846
#	endif
#endif

using namespace IDCT;

CInterface* CIEEE1180::m_pInstance = NULL;

CIEEE1180::CIEEE1180()
{
	PrepareTable();
}

CIEEE1180::~CIEEE1180()
{

}

CInterface* CIEEE1180::GetInstance()
{
	if(m_pInstance == NULL)
	{
		m_pInstance = new CIEEE1180();
	}

	return m_pInstance;
}

void CIEEE1180::PrepareTable()
{
	int freq, time;
	double scale;

	for (freq=0; freq < 8; freq++)
	{
		scale = (freq == 0) ? sqrt(0.125) : 0.5;
		for (time=0; time<8; time++)
		{
			m_nC[freq][time] = scale*cos((PI/8.0)*freq*(time + 0.5));
		}
	}
}

void CIEEE1180::Transform(const int16* pUV, int16* pXY)
{
#if defined(__wasm_simd128__)
	// Adjacent independent outputs share a vector. Every lane keeps the pinned
	// scalar coefficient, k order, separate multiply/add and floor(x + 0.5).
	// Complete the first pass before any output store, including aliased input.
	double tmp[64];
	for(int i = 0; i < 8; i++)
	{
		for(int j = 0; j < 8; j += 2)
		{
			v128_t sum = wasm_f64x2_splat(0.0);
			for(int k = 0; k < 8; k++)
			{
				const auto coeff = wasm_v128_load(&m_nC[k][j]);
				const auto value = wasm_f64x2_splat(pUV[8 * i + k]);
				sum = wasm_f64x2_add(sum, wasm_f64x2_mul(coeff, value));
			}
			wasm_v128_store(&tmp[8 * i + j], sum);
		}
	}
	for(int j = 0; j < 8; j++)
	{
		for(int i = 0; i < 8; i += 2)
		{
			v128_t sum = wasm_f64x2_splat(0.0);
			for(int k = 0; k < 8; k++)
			{
				const auto coeff = wasm_v128_load(&m_nC[k][i]);
				const auto value = wasm_f64x2_splat(tmp[8 * k + j]);
				sum = wasm_f64x2_add(sum, wasm_f64x2_mul(coeff, value));
			}
			sum = wasm_f64x2_floor(wasm_f64x2_add(sum, wasm_f64x2_splat(0.5)));
			pXY[8 * i + j] = static_cast<int>(wasm_f64x2_extract_lane(sum, 0));
			pXY[8 * (i + 1) + j] = static_cast<int>(wasm_f64x2_extract_lane(sum, 1));
		}
	}
#else

	int i, j, k, v;
	double partial_product;
	double tmp[64];

	for (i=0; i<8; i++)
	{
		for (j=0; j<8; j++)
		{
			partial_product = 0.0;

			for (k=0; k<8; k++)
			{
				partial_product+= m_nC[k][j]*pUV[8*i+k];
			}

			tmp[8*i+j] = partial_product;
		}
    }

  /* Transpose operation is integrated into address mapping by switching 
     loop order of i and j */

	for (j=0; j<8; j++)
	{
		for (i=0; i<8; i++)
		{
			partial_product = 0.0;

			for (k=0; k<8; k++)
			{
				partial_product+= m_nC[k][i]*tmp[8*k+j];
			}

			v = (int) floor(partial_product+0.5);
			pXY[8*i+j] = v;
		}
	}
#endif
}
