import { glsl } from '@lib/tags';

/** Falling sand shaders using block cellular automata with Margolus offsets.
 * Based on "Probabilistic Cellular Automata for Granular Media in Video Games" (https://arxiv.org/abs/2008.06341)
 * Code adapted from https://github.com/GelamiSalami/GPU-Falling-Sand-CA
 */

const CONSTANTS = glsl`
#define AIR 0.0
#define SMOKE 1.0
#define WATER 2.0
#define LAVA 3.0
#define SAND 4.0
#define PLANT 5.0
#define STONE 6.0
#define WALL 7.0
#define COLLISION 99.0
#define ICE 8.0
#define FIRE 9.0
#define STEAM 10.0

const vec3 bgColor = vec3(1.0, 1.0, 1.0);
`;

const UTILS = glsl`

const float EPSILON = 1e-4;

const float PI = acos(-1.);
const float TAU = PI * 2.0;

vec3 saturate(vec3 x) { return clamp(x, vec3(0), vec3(1)); }

// https://iquilezles.org/articles/palettes/
vec3 palette(float t)
{
	return .5 + .5 * cos(TAU * (vec3(1, 1, 1) * t + vec3(0, .33, .67)));
}

// Hash without Sine
// https://www.shadertoy.com/view/4djSRW
float hash12(vec2 p)
{
	vec3 p3  = fract(vec3(p.xyx) * .1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3)
{
	p3  = fract(p3 * .1031);
	p3 += dot(p3, p3.zyx + 31.32);
	return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p3)
{
	p3 = fract(p3 * vec3(.1031, .1030, .0973));
	p3 += dot(p3, p3.yxz+33.33);
	return fract((p3.xxy + p3.yxx)*p3.zyx);
}

vec4 hash43(vec3 p)
{
	vec4 p4 = fract(vec4(p.xyzx)  * vec4(.1031, .1030, .0973, .1099));
	p4 += dot(p4, p4.wzxy+33.33);
	return fract((p4.xxyz+p4.yzzw)*p4.zywx);
}

vec3 linearTosRGB(vec3 col)
{
	return mix(1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, col * 12.92, lessThan(col, vec3(0.0031308)));
}
`;

/** Vertex shader for rendering quads */
export const vertexShader = glsl`#version 300 es
in vec4 aPosition;
in vec2 aUv;

out vec2 outUv;

void main() {
	gl_Position = aPosition;
	outUv = aUv;
}
`;

export const simulationShader = glsl`#version 300 es
precision mediump float;

uniform vec2 resolution;
uniform float time;
uniform int frame;
uniform vec4 mouse;
uniform int materialType;
uniform float brushRadius;
uniform sampler2D tex;
uniform sampler2D u_collisionTex;
uniform float initialSand;

in vec2 outUv;

out vec4 fragColor;

${CONSTANTS}
${UTILS}

// https://iquilezles.org/articles/distfunctions2d/
float sdSegment(vec2 p, vec2 a, vec2 b)
{
	vec2 pa = p-a, ba = b-a;
	float h = clamp( dot(pa,ba) / dot(ba,ba), 0.0, 1.0 );
	return length( pa - ba*h );
}

ivec2 getOffset(int frame)
{
	int i = frame % 4;
	if (i == 0)
		return ivec2(0, 0);
	else if (i == 1)
		return ivec2(1, 1);
	else if (i == 2)
		return ivec2(0, 1);
	return ivec2(1, 0);
}

vec4 getData(ivec2 p)
{
    // Check boundaries first
    if (p.x < 0 || p.y < 0 || p.x >= int(resolution.x) || p.y >= int(resolution.y)) {
        return vec4(vec3(0.02), WALL);
    }
    
    // Calculate UV coordinates for the collision texture
    vec2 collisionUv = (vec2(p) + 0.5) / resolution;
    float collisionValue = texture(u_collisionTex, collisionUv).r;
    
    // If there's a collision at this position, always return COLLISION type
    if (collisionValue > 0.5) {
        return vec4(bgColor, COLLISION);
    }
    
    // If no collision, get the data from the simulation texture
    vec4 data = texelFetch(tex, p, 0);
    if (data.xyz == vec3(0)) {
        data.xyz = bgColor;
    }
    return data;
}

void swap(inout vec4 a, inout vec4 b)
{
	vec4 tmp = a;
	a = b;
	b = tmp;
}

vec4 createParticle(float id)
{
	if (id == AIR)
	{
		return vec4(0.0, 0.0, 0.0, AIR);
	} 
	else if (id == STEAM || id == SMOKE)
	{
		return vec4(hash13(vec3(gl_FragCoord.xy, frame)), 0.0, 0.0, id);
	}
	else if (id == WATER)
	{
		return vec4(hash13(vec3(gl_FragCoord.xy, frame)), 0.0, 0.0, WATER);
	} 
	else if (id == LAVA || id == SAND || id == ICE)
	{
		return vec4(hash13(vec3(gl_FragCoord.xy, frame)), 0.0, 0.0, id);
	} 
	else if (id == PLANT)
	{
		return vec4(hash13(vec3(gl_FragCoord.xy, frame)), 0.0, 0.5, PLANT); 
	} 
	else if (id == STONE || id == WALL)
	{
		return vec4(hash13(vec3(gl_FragCoord.xy, frame)), 0.0, 0.0, id);
	}
	else if (id == FIRE)
	{
		// Use r for randomness, b for heat (0.5-1.0 range for initial heat)
		return vec4(hash13(vec3(gl_FragCoord.xy, frame)), 0.0, 0.5 + hash13(vec3(gl_FragCoord.xy, float(frame) + 1.0)) * 0.5, FIRE);
	}
	return vec4(0.0, 0.0, 0.0, AIR);
}

void main() {
	vec2 uv = gl_FragCoord.xy / resolution;

	if (frame == 0) {
		float r = hash12(gl_FragCoord.xy);
		float id = AIR;
		if (r < initialSand)
		{
			id = SAND;
		} 

		fragColor = createParticle(id);
		return;
	}

	if (mouse.x > 0.0)
	{
		float d = sdSegment(gl_FragCoord.xy, mouse.xy, mouse.zw);
		if (d < brushRadius)
		{
			fragColor = createParticle(float(materialType));
			return;
		}
	}

	ivec2 offset = getOffset(frame);
	ivec2 fc = ivec2(gl_FragCoord.xy) + offset;
	ivec2 p = (fc / 2) * 2 - offset;
	ivec2 xy = fc % 2;
	int i = xy.x + xy.y * 2;

	vec4 t00 = getData(p);                  // top-left
	vec4 t10 = getData(p + ivec2(1, 0));    // top-right
	vec4 t01 = getData(p + ivec2(0, 1));    // bottom-left
	vec4 t11 = getData(p + ivec2(1, 1));    // bottom-right

	vec4 tn00 = getData(p + ivec2(0, -1));
	vec4 tn10 = getData(p + ivec2(1, -1));

	if (t00.a == t10.a && t01.a == t11.a && t00.a == t01.a)
	{
		fragColor = i == 0 ? t00 :
					i == 1 ? t10 :
					i == 2 ? t01 : t11;
		return;
	}

	vec4 r = hash43(vec3(p, frame));

	if ((t01.a == SMOKE && t11.a < SMOKE ||
		t01.a < SMOKE && t11.a == SMOKE ||
		t01.a == STEAM && t11.a < STEAM ||
		t01.a < STEAM && t11.a == STEAM) && r.x < 0.25)
	{
		swap(t01, t11);
	}
	
		
	if ((t01.a == STEAM && t11.a < STEAM ||
		t01.a < STEAM && t11.a == STEAM) && r.x < 0.25)
	{
		swap(t01, t11);
	}

	if (t00.a == SMOKE || t00.a == STEAM)
	{
		if (t01.a < t00.a && r.y < 0.25)
		{
			swap(t00, t01);
		} else if (r.z < 0.003)
		{
			t00 = vec4(bgColor, AIR);
		} else if (t00.a == STEAM && r.w < 0.001) { // Small chance for steam to condense
			t00 = createParticle(WATER);
		}
	}
	if (t10.a == SMOKE || t10.a == STEAM)
	{
		if (t11.a < t10.a && r.y < 0.25)
		{
			swap(t10, t11);
		} else if (r.z < 0.003)
		{
			t10 = vec4(bgColor, AIR);
		}
	}

	if (((t01.a == SAND) && t11.a < SAND ||
		t01.a < SAND && (t11.a == SAND)) &&
		t00.a < SAND && t10.a < SAND && r.x < 0.4)
	{
		swap(t01, t11);
	}

	if (t01.a == SAND || t01.a == STONE)
	{
		if (t00.a < SAND && t00.a != WATER && t00.a != LAVA)
		{
			if (r.y < 0.9) swap(t01, t00);
		}
		else if (t00.a == WATER)
		{
			if (r.y < 0.3) swap(t01, t00);
		}
		else if (t00.a == LAVA)
		{
			float fallProb = t01.a == SAND ? 0.15 : 0.25;
			if (r.y < fallProb) swap(t01, t00);
		}
		else if (t11.a < SAND && t10.a < SAND)
		{
			swap(t01, t10);
		}
	}

	if (t11.a == SAND || t11.a == STONE)
	{
		if (t10.a < SAND && t10.a != WATER && t10.a != LAVA)
		{
			if (r.y < 0.9) swap(t11, t10);
		}
		else if (t10.a == WATER)
		{
			if (r.y < 0.3) swap(t11, t10);
		}
		else if (t10.a == LAVA)
		{
			float fallProb = t11.a == SAND ? 0.15 : 0.25;
			if (r.y < fallProb) swap(t11, t10);
		}
		else if (t01.a < SAND && t00.a < SAND)
		{
			swap(t11, t00);
		}
	}

	bool drop = false;
	if (t01.a == WATER)
	{
		if (t00.a < t01.a && r.y < 0.95)
		{
			swap(t01, t00);
			drop = true;
		} else if (t11.a < t01.a && t10.a < t01.a && r.z < 0.3)
		{
			swap(t01, t10);
			drop = true;
		}
	}
	if (t11.a == WATER)
	{
		if (t10.a < t11.a && r.y < 0.95)
		{
			swap(t11, t10);
			drop = true;
		} else if (t01.a < t11.a && t00.a < t11.a && r.z < 0.3)
		{
			swap(t11, t00);
			drop = true;
		}
	}
	
	if (!drop)
	{
		if ((t01.a == WATER && t11.a < WATER ||
			t01.a < WATER && t11.a == WATER) &&
			(t00.a >= WATER && t10.a >= WATER || r.w < 0.8))
		{
			swap(t01, t11);
		}
		if ((t00.a == WATER && t10.a < WATER ||
			t00.a < WATER && t10.a == WATER) &&
			(tn00.a >= WATER && tn10.a >= WATER || r.w < 0.8))
		{
			swap(t00, t10);
		}
	}

	if (t01.a == LAVA)
	{
		if (t00.a < t01.a && r.y < 0.8)
		{
			swap(t01, t00);
		} else if (t11.a < t01.a && t10.a < t01.a && r.z < 0.2)
		{
			swap(t01, t10);
		}
	}
	if (t11.a == LAVA)
	{
		if (t10.a < t11.a && r.y < 0.8)
		{
			swap(t11, t10);
		} else if (t01.a < t11.a && t00.a < t11.a && r.z < 0.2)
		{
			swap(t11, t00);
		}
	}

	if (t00.a == LAVA)
	{
		if (t01.a == WATER)
		{
			t00 = createParticle(STONE);
			t01 = createParticle(SMOKE);
		} else if (t10.a == WATER)
		{
			t00 = createParticle(STONE);
			t10 = createParticle(SMOKE);
		} else if (t01.a == PLANT && r.x < 0.03) // left
		{
			t01 = createParticle(SMOKE);
			if (r.y < 0.04) {
				t00 = createParticle(STONE);
			}
		} else if (t10.a == PLANT && r.x < 0.03) // right
		{
			t10 = createParticle(SMOKE);
			if (r.y < 0.04) {
				t10 = createParticle(STONE);
			}
		}
	}

	if (t10.a == LAVA)
	{
		if (t11.a == WATER)
		{
			t10 = createParticle(STONE);
			t11 = createParticle(SMOKE);
		} else if (t00.a == WATER)
		{
			t10 = createParticle(STONE);
			t00 = createParticle(SMOKE);
		} else if (t11.a == PLANT && r.x < 0.03)
		{
			t11 = createParticle(SMOKE);
			if (r.y < 0.04) {
				t10 = createParticle(STONE);
			}
		} else if (t00.a == PLANT && r.x < 0.03)
		{
			t00 = createParticle(SMOKE);
			if (r.y < 0.04) {
				t10 =  createParticle(STONE);
			}
		}
	}

	if (t01.a == LAVA)
	{
		if (t00.a == PLANT && r.x < 0.03)
		{
			t00 = createParticle(SMOKE);
			if (r.y < 0.04) {
				t01 = createParticle(STONE);
			}
		} else if (t11.a == PLANT && r.x < 0.03)
		{
			t11 = createParticle(SMOKE);
			if (r.y < 0.04) {
				t01 = createParticle(STONE);
			}
		}
	}

	if (t11.a == LAVA)
	{
		if (t10.a == PLANT && r.x < 0.03)
		{
			t10 = createParticle(SMOKE);
			if (r.y < 0.04) {
				t11 = createParticle(STONE);
			}
		} else if (t01.a == PLANT && r.x < 0.03)
		{
			t01 = createParticle(SMOKE);
			if (r.y < 0.04) {
				t11 =  createParticle(STONE);
			}
		}
	}

	if ((t01.a == LAVA && t11.a < LAVA ||
		t01.a < LAVA && t11.a == LAVA) && r.x < 0.6)
	{
		swap(t01, t11);
	}

	// Plant growth and water propagation
	if (t00.a == PLANT)
	{
		// Direct water contact increases water level and has a chance to consume water
		if (t01.a == WATER) {
			t00.b = min(t00.b + 0.1, 1.0);
			if (r.x < 0.1) {
				t01 = createParticle(AIR);
			}
		}
		if (t10.a == WATER) {
			t00.b = min(t00.b + 0.1, 1.0);
			if (r.y < 0.1) { // Using r.y for different randomness
				t10 = createParticle(AIR);
			}
		}
		
		// Propagate water to nearby plants (use red channel)
		if (t01.a == PLANT) {
			float avgWater = (t00.b + t01.b) * 0.5;
			t00.b = t01.b = avgWater;
		}
		if (t10.a == PLANT) {
			float avgWater = (t00.b + t10.b) * 0.5;
			t00.b = t10.b = avgWater;
		}

		// Growth primarily happens upward if water level is sufficient
		if (t00.b > 0.4)
		{
			if ((t01.a == AIR || t10.a == AIR) && r.x < 0.01)
			{
				if (r.y < 0.8 && t01.a == AIR)
				{
					t01 = createParticle(PLANT);
					t00.b *= 0.7;
				}
				else if (t10.a == AIR)
				{
					t10 = createParticle(PLANT);
					t00.b *= 0.7;
				}
			}
		}
	}

	// Similar updates for t10
	if (t10.a == PLANT)
	{
		if (t11.a == WATER) {
			t10.b = min(t10.b + 0.1, 1.0);
			if (r.z < 0.1) {
				t11 = createParticle(AIR);
			}
		}
		if (t00.a == WATER) {
			t10.b = min(t10.b + 0.1, 1.0);
			if (r.w < 0.1) {
				t00 = createParticle(AIR);
			}
		}
		
		if (t11.a == PLANT) {
			float avgWater = (t10.b + t11.b) * 0.5;
			t10.b = t11.b = avgWater;
		}
		if (t00.a == PLANT) {
			float avgWater = (t10.b + t00.b) * 0.5;
			t10.b = t00.b = avgWater;
		}

		if (t10.b > 0.4)
		{
			if ((t11.a == AIR || t00.a == AIR) && r.x < 0.01)
			{
				if (r.y < 0.8 && t11.a == AIR)
				{
					t11 = createParticle(PLANT);
					t10.b *= 0.7;
				}
				else if (t00.a == AIR)
				{
					t00 = createParticle(PLANT);
					t10.b *= 0.7;
				}
			}
		}
	}

	if (t01.a == PLANT)
	{
		if (t00.a == WATER) {
			t01.b = min(t01.b + 0.1, 1.0);
			if (r.x < 0.1) {
				t00 = createParticle(AIR);
			}
		}
		if (t11.a == WATER) {
			t01.b = min(t01.b + 0.1, 1.0);
			if (r.y < 0.1) {
				t11 = createParticle(AIR);
			}
		}
		
		if (t00.a == PLANT) {
			float avgWater = (t01.b + t00.b) * 0.5;
			t01.b = t00.b = avgWater;
		}
		if (t11.a == PLANT) {
			float avgWater = (t01.b + t11.b) * 0.5;
			t01.b = t11.b = avgWater;
		}

		if (t01.b > 0.4)
		{
			if ((t00.a == AIR || t11.a == AIR) && r.x < 0.01)
			{
				if (r.y < 0.8 && t00.a == AIR)
				{
					t00 = createParticle(PLANT);
					t01.b *= 0.7;
				}
				else if (t11.a == AIR)
				{
					t11 = createParticle(PLANT);
					t01.b *= 0.7;
				}
			}
		}
	}

	if (t11.a == PLANT)
	{
		if (t10.a == WATER) {
			t11.b = min(t11.b + 0.1, 1.0);
			if (r.z < 0.1) {
				t10 = createParticle(AIR);
			}
		}
		if (t01.a == WATER) {
			t11.b = min(t11.b + 0.1, 1.0);
			if (r.w < 0.1) {
				t00 = createParticle(AIR);
			}
		}
		
		if (t10.a == PLANT) {
			float avgWater = (t11.b + t10.b) * 0.5;
			t11.b = t10.b = avgWater;
		}
		if (t01.a == PLANT) {
			float avgWater = (t11.b + t01.b) * 0.5;
			t11.b = t01.b = avgWater;
		}

		if (t11.b > 0.4)
		{
			if ((t10.a == AIR || t01.a == AIR) && r.x < 0.01)
			{
				if (r.y < 0.8 && t10.a == AIR)
				{
					t10 = createParticle(PLANT);
					t11.b *= 0.7;
				}
				else if (t01.a == AIR)
				{
					t01 = createParticle(PLANT);
					t11.b *= 0.7;
				}
			}
		}
	}

	// Ice melting near lava
	if (t00.a == ICE)
	{
		// Check for nearby lava
		if (t01.a == LAVA || t10.a == LAVA)
		{
			if (r.x < 0.2) { // 20% chance to melt per frame
				t00 = createParticle(STEAM);
				// Create additional steam from the lava contact points
				if (r.y < 0.5) {
					if (t01.a == LAVA) t01 = createParticle(STEAM);
					if (t10.a == LAVA) t10 = createParticle(STEAM);
				}
			}
		}
	}

	// Similar checks for other ice positions
	if (t10.a == ICE)
	{
		if (t11.a == LAVA || t00.a == LAVA)
		{
			if (r.x < 0.2) {
				t10 = createParticle(STEAM);
				if (r.y < 0.5) {
					if (t11.a == LAVA) t11 = createParticle(STEAM);
					if (t00.a == LAVA) t00 = createParticle(STEAM);
				}
			}
		}
	}

	// Water freezing into ice
	if (t00.a == WATER)
	{
		// Check for nearby ice
		if (t01.a == ICE || t10.a == ICE)
		{
			if (r.x < 0.05) { // 5% chance to freeze per frame
				t00 = createParticle(ICE);
			}
		}
	}

	// Similar checks for other water positions
	if (t10.a == WATER)
	{
		if (t11.a == ICE || t00.a == ICE)
		{
			if (r.x < 0.05) {
				t10 = createParticle(ICE);
			}
		}
	}

	// Fire behavior
	if (t00.a == FIRE)
	{
		// Count nearby fire particles
		float nearbyFire = 0.0;
		if (t01.a == FIRE) nearbyFire += 1.0;
		if (t10.a == FIRE) nearbyFire += 1.0;
		if (t11.a == FIRE) nearbyFire += 1.0;
		
		// More nearby fire increases smoke production
		float smokeChance = nearbyFire * 0.1;
		
		// Spread fire in all directions, with upward bias
		// Up
		if (t01.a == AIR && r.x < t00.b * 0.4)
		{
			t01 = createParticle(FIRE);
			t01.b = max(t00.b - 0.1, 0.1);
		}
		// Right/Left symmetric movement (like water/sand)
		if ((t01.a == AIR && t11.a == FIRE ||
			t01.a == FIRE && t11.a == AIR) && r.y < t00.b * 0.2)
		{
			swap(t01, t11);
		}
		if ((t00.a == FIRE && t10.a == AIR ||
			t00.a == AIR && t10.a == FIRE) && r.z < t00.b * 0.2)
		{
			swap(t00, t10);
		}
		
		// Fire spreads to plants and gains heat from them
		if (t01.a == PLANT && r.x < t00.b * 0.8)
		{
			t01 = createParticle(FIRE);
			t01.b = min(t00.b + 0.2, 1.0);
		}
		if (t10.a == PLANT && r.y < t00.b * 0.8)
		{
			t10 = createParticle(FIRE);
			t10.b = min(t00.b + 0.2, 1.0);
		}
		if (t11.a == PLANT && r.z < t00.b * 0.8)
		{
			t11 = createParticle(FIRE);
			t11.b = min(t00.b + 0.2, 1.0);
		}
		
		// Fire loses heat over time, less when surrounded by fire
		float heatLoss = 0.01 * (1.0 - nearbyFire * 0.2);
		t00.b = max(t00.b - heatLoss, 0.0);
		
		// Convert to smoke based on heat and nearby fire
		if ((t00.b < 0.1 && r.z < 0.1) || r.w < smokeChance)
		{
			t00 = createParticle(SMOKE);
		}
		
		// Create smoke above fire, more likely with higher heat
		if (t01.a == AIR && r.w < t00.b * 0.2)
		{
			t01 = createParticle(SMOKE);
		}
	}

	// Lava ignites plants and creates fire
	if (t00.a == LAVA && t01.a == PLANT && r.x < 0.3)
	{
		t01 = createParticle(FIRE);
		t01.b = 1.0; // Start with maximum heat
	}

	fragColor = i == 0 ? t00 :
    i == 1 ? t10 :
    i == 2 ? t01 : t11;

	if (fragColor.a == COLLISION) {
		vec2 collisionUv = gl_FragCoord.xy / resolution;
		float collisionValue = texture(u_collisionTex, collisionUv).r;
		if (collisionValue <= 0.5) {
			fragColor = vec4(bgColor, AIR);
		}
	}
}
`;

export const distanceFieldInitShader = glsl`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform sampler2D dataTex;

${CONSTANTS}

layout(location = 0) out vec4 fragColorR;
layout(location = 1) out vec4 fragColorG;
layout(location = 2) out vec4 fragColorB;

void main()
{
	vec2 uv = gl_FragCoord.xy / resolution;

	vec4 data = texture(dataTex, uv);
	// Expand the single channel here too
	data.gb = data.rr;

	fragColorR = vec4(-1, -1, 0, 0);
	fragColorG = vec4(-1, -1, 0, 0);
	fragColorB = vec4(-1, -1, 0, 0);

	if (data.a <= LAVA)
	{
		fragColorR.xy = gl_FragCoord.xy;
		fragColorG.xy = gl_FragCoord.xy;
		fragColorB.xy = gl_FragCoord.xy;
	}
	if (data.a == SMOKE)
	{
		fragColorR.w = 6.0;
		fragColorG.w = 6.0;
		fragColorB.w = 6.0;
	} else if (data.a == WATER)
	{
		fragColorR.w = 9.0;
		fragColorG.w = 6.0;
		fragColorB.w = 4.0;
	} else if (data.a == LAVA)
	{
		fragColorR.w = 0.0;
		fragColorG.w = 11.0;
		fragColorB.w = 14.0;
	} else if (data.a == PLANT)
	{
		fragColorR.w = 4.0 - data.r * 4.0;
		fragColorG.w = 4.0 - data.r * 4.0;
		fragColorB.w = 4.0 - data.r * 4.0;
	}
}
`;

export const distanceFieldPropagationShader = glsl`#version 300 es
precision highp float;

uniform float stepSize;
uniform vec2 resolution;
uniform sampler2D texR;
uniform sampler2D texG;
uniform sampler2D texB;

uniform int passCount;
uniform int passIndex;

layout(location = 0) out vec4 fragColorR;
layout(location = 1) out vec4 fragColorG;
layout(location = 2) out vec4 fragColorB;

void main()
{
	vec2 fc = gl_FragCoord.xy;

	vec4 bestR = vec4(0,0,1e3,0);
	vec4 bestG = vec4(0,0,1e3,0);
	vec4 bestB = vec4(0,0,1e3,0);

	for (int x = -1; x <= 1; x++)
	{
		for (int y = -1; y <= 1; y++)
		{
			vec2 p = fc + vec2(x, y) * stepSize;

			vec4 dataR = texture(texR, p / resolution);
			vec4 dataG = texture(texG, p / resolution);
			vec4 dataB = texture(texB, p / resolution);

			if (dataR.xy != vec2(-1) && dataR.xy == clamp(dataR.xy, vec2(0.5), resolution-0.5))
			{
				float dist = distance(fc, dataR.xy) + dataR.w;
				if (dist < bestR.z)
				{
					bestR = dataR;
					bestR.z = dist;
				}
			}
			if (dataG.xy != vec2(-1) && dataG.xy == clamp(dataG.xy, vec2(0.5), resolution-0.5))
			{
				float dist = distance(fc, dataG.xy) + dataG.w;
				if (dist < bestG.z)
				{
					bestG = dataG;
					bestG.z = dist;
				}
			}
			if (dataB.xy != vec2(-1) && dataB.xy == clamp(dataB.xy, vec2(0.5), resolution-0.5))
			{
				float dist = distance(fc, dataB.xy) + dataB.w;
				if (dist < bestB.z)
				{
					bestB = dataB;
					bestB.z = dist;
				}
			}
		}
	}

	fragColorR = vec4(bestR.xy, bestR.z != 1e3 ? bestR.z : 1e3, bestR.w);
	fragColorG = vec4(bestG.xy, bestG.z != 1e3 ? bestG.z : 1e3, bestG.w);
	fragColorB = vec4(bestB.xy, bestB.z != 1e3 ? bestB.z : 1e3, bestB.w);

	if (passIndex == passCount - 1)
	{
		if (bestR.xy == vec2(-1))
			fragColorR.z = 1e3;
		if (bestG.xy == vec2(-1))
			fragColorG.z = 1e3;
		if (bestB.xy == vec2(-1))
			fragColorB.z = 1e3;
	}
}
`;

export const visualizationShader = glsl`#version 300 es
precision highp float;

uniform vec2 texResolution;
uniform float texScale;
uniform vec2 resolution;
uniform sampler2D tex;
uniform sampler2D shadowTexR;
uniform sampler2D shadowTexG;
uniform sampler2D shadowTexB;
uniform sampler2D u_collisionTex;
uniform float scale;

${CONSTANTS}

out vec4 fragColor;

vec2 getCoordsAA(vec2 uv)
{
	float w = 1.5; // 1.5
	vec2 fl = floor(uv + 0.5);
	vec2 fr = fract(uv + 0.5);
	vec2 aa = fwidth(uv) * w * 0.5;
	fr = smoothstep(0.5 - aa, 0.5 + aa, fr);

	return fl + fr - 0.5;
}

vec3 linearTosRGB(vec3 col)
{
	return mix(1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, col * 12.92, lessThan(col, vec3(0.0031308)));
}

vec3 getParticleColor(vec4 data)
{
	float rand = data.r; // Our stored random value

	if (data.a == AIR) {
		return bgColor;
	}
	else if (data.a == STEAM) {
		return mix(bgColor, vec3(0.7, 0.7, 0.7), 0.6 + rand * 0.2);
	}
	else if (data.a == SMOKE) {
		return mix(bgColor, vec3(0.2), 0.6 + rand * 0.2);
	}
	else if (data.a == WATER) {
		// Deeper blue for better contrast on white
		vec3 waterColor = vec3(0.1, 0.3, 0.8);
		return mix(bgColor, waterColor, 0.7 + rand * 0.2);
	}
	else if (data.a == LAVA) {
		// More saturated lava colors for white bg
		vec3 baseColor = vec3(0.9, 0.2, 0.05);
		vec3 glowColor = vec3(1.0, 0.4, 0.1);
		return mix(baseColor, glowColor, rand) * (0.8 + rand * 0.4);
	}
	else if (data.a == SAND) {
		// Deeper sand colors for contrast
		vec3 baseColor = vec3(0.76, 0.52, 0.17);
		vec3 altColor = vec3(0.72, 0.48, 0.13);
		return mix(baseColor, altColor, rand) * (0.8 + rand * 0.3);
	}
	else if (data.a == PLANT) {
		// Darker green for contrast
		vec3 darkGreen = vec3(0.1, 0.45, 0.1);
		vec3 lightGreen = vec3(0.15, 0.55, 0.15);
		vec3 baseColor = mix(darkGreen, lightGreen, rand);
		return baseColor * (0.7 + data.b * 0.5);
	}
	else if (data.a == STONE) {
		// Darker stone
		vec3 baseColor = vec3(0.3, 0.32, 0.34);
		vec3 altColor = vec3(0.25, 0.27, 0.29);
		return mix(baseColor, altColor, rand) * (0.7 + rand * 0.3);
	}
	else if (data.a == WALL) {
		return vec3(0.4, 0.4, 0.4) * (rand * 0.4 + 0.6); // Darker wall
	}
	else if (data.a == ICE) {
		// More blue for ice to stand out on white
		vec3 baseColor = vec3(0.7, 0.8, 1.0);
		vec3 altColor = vec3(0.6, 0.75, 0.95);
		return mix(baseColor, altColor, rand) * (0.85 + rand * 0.2);
	}
	else if (data.a == FIRE) {
		// More saturated fire colors
		vec3 coolColor = vec3(0.9, 0.3, 0.0);  // More orange
		vec3 hotColor = vec3(1.0, 0.8, 0.2);   // More yellow
		
		vec3 fireColor = mix(coolColor, hotColor, data.b);
		return fireColor * (0.9 + data.r * 0.3);
	}
	return bgColor;
}

void main() {
	vec2 uv = gl_FragCoord.xy / (texResolution * texScale);

	uv -= 0.5;
	uv *= scale;
	uv += 0.5;

	vec2 fc = uv * texResolution;

	vec4 data = texture(tex, getCoordsAA(fc) / texResolution);
	vec4 dataUp = texture(tex, getCoordsAA(fc + vec2(0, 1)) / texResolution);
	vec4 dataDown = texture(tex, getCoordsAA(fc - vec2(0, 1)) / texResolution);

	// Expand single channel into RGB for each sample
	data.gb = data.rr;
	dataUp.gb = dataUp.rr;
	dataDown.gb = dataDown.rr;

	float hig = float(data.a > dataUp.a);
	float dropSha = 1.0 - float(data.a > dataDown.a);

	vec3 color = getParticleColor(data);

	vec4 shaDataR = texture(shadowTexR, uv);
	vec4 shaDataG = texture(shadowTexG, uv);
	vec4 shaDataB = texture(shadowTexB, uv);
	
	float shaR = shaDataR.xy != vec2(-1) ? shaDataR.z : 16.0;
	float shaG = shaDataG.xy != vec2(-1) ? shaDataG.z : 16.0;
	float shaB = shaDataB.xy != vec2(-1) ? shaDataB.z : 16.0;

	vec3 sha = clamp(1.0 - vec3(shaR, shaG, shaB) / 16.0, vec3(0.0), vec3(1.0));
	sha = mix(vec3(0.7), vec3(1.0), sha * sha); // Less dramatic shadows for white bg

	// Add extra lava glow contribution
	if (data.a == LAVA) {
		// Internal darkening for depth
		float depth = 1.0 - sha.r; // Invert shadow for depth
		color *= 0.8 + 0.4 * (1.0 - depth * depth); // Darker internal areas
		
		// Keep strong red lighting emission for affecting neighboring particles
		vec3 emission = vec3(0.6, 0.05, 0.0) * depth * depth;
		color += emission;
	}

	color *= 0.5 * max(hig, dropSha) + 0.5;
	color *= sha * 1.0 + 0.2;
	color += color * 0.4 * hig;

	if (data.a == FIRE) {
		// Add glow based on heat
		float glowIntensity = data.b * data.b; // Square for more dramatic effect
		vec3 glowColor = vec3(1.0, 0.3, 0.1) * glowIntensity;
		color += glowColor * 0.5;
	}

	fragColor = vec4(linearTosRGB(color), 1.0);
}
`;

export const collisionVertexShader = glsl`#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;

void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

export const collisionFragmentShader = glsl`#version 300 es
precision highp float;

out vec4 fragColor;

void main() {
    fragColor = vec4(1.0, 0.0, 0.0, 1.0); // red represents solid
}`;
