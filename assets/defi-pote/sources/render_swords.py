"""Render the same deterministic GLSL scene through local EGL / OpenGL."""
import argparse,ctypes as C,time,json,subprocess
from ctypes.util import find_library
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--direction',type=int,default=0,choices=[0,1,2])
parser.add_argument('--width',type=int,default=1080)
parser.add_argument('--height',type=int,default=788)
parser.add_argument('--samples',type=int,default=1)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
vp=C.c_void_p;I=C.c_int;U=C.c_uint;F=C.c_float
egl=C.CDLL(find_library('EGL'))
def ef(name,restype,argtypes):
    f=getattr(egl,name);f.restype=restype;f.argtypes=argtypes;return f
platform=ef('eglGetPlatformDisplay',vp,[U,vp,C.POINTER(I)])
init=ef('eglInitialize',U,[vp,C.POINTER(I),C.POINTER(I)])
bind=ef('eglBindAPI',U,[U]);choose=ef('eglChooseConfig',U,[vp,C.POINTER(I),C.POINTER(vp),I,C.POINTER(I)])
surf=ef('eglCreatePbufferSurface',vp,[vp,vp,C.POINTER(I)])
context=ef('eglCreateContext',vp,[vp,vp,vp,C.POINTER(I)])
make=ef('eglMakeCurrent',U,[vp,vp,vp,vp]);getproc=ef('eglGetProcAddress',vp,[C.c_char_p])
err=ef('eglGetError',U,[])
d=platform(0x31DD,None,None);a=I();b=I();assert init(d,C.byref(a),C.byref(b)),hex(err());assert bind(0x30A2)
attrs=(I*15)(0x3033,1,0x3040,8,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3025,24,0x3038)
conf=vp();count=I();assert choose(d,attrs,C.byref(conf),1,C.byref(count)) and count.value
sa=(I*5)(0x3057,args.width,0x3056,args.height,0x3038);s=surf(d,conf,sa)
ca=(I*7)(0x3098,3,0x30FB,3,0x30FD,1,0x3038);c=context(d,conf,None,ca)
assert s and c and make(d,s,s,c),hex(err())
def gl(name,restype,argtypes):
    address=getproc(name.encode());assert address,name
    return C.CFUNCTYPE(restype,*argtypes)(address)
createShader=gl('glCreateShader',U,[U]);shaderSource=gl('glShaderSource',None,[U,I,C.POINTER(C.c_char_p),C.POINTER(I)])
compileShader=gl('glCompileShader',None,[U]);getShader=gl('glGetShaderiv',None,[U,U,C.POINTER(I)])
shaderLog=gl('glGetShaderInfoLog',None,[U,I,C.POINTER(I),C.c_char_p])
createProgram=gl('glCreateProgram',U,[]);attach=gl('glAttachShader',None,[U,U]);link=gl('glLinkProgram',None,[U]);use=gl('glUseProgram',None,[U])
getProgram=gl('glGetProgramiv',None,[U,U,C.POINTER(I)]);programLog=gl('glGetProgramInfoLog',None,[U,I,C.POINTER(I),C.c_char_p])
getUniform=gl('glGetUniformLocation',I,[U,C.c_char_p]);uniform1i=gl('glUniform1i',None,[I,I]);uniform1f=gl('glUniform1f',None,[I,F]);uniform2f=gl('glUniform2f',None,[I,F,F])
genVA=gl('glGenVertexArrays',None,[I,C.POINTER(U)]);bindVA=gl('glBindVertexArray',None,[U])
genTex=gl('glGenTextures',None,[I,C.POINTER(U)]);bindTex=gl('glBindTexture',None,[U,U]);texParam=gl('glTexParameteri',None,[U,U,I]);texImage=gl('glTexImage2D',None,[U,I,I,I,I,I,U,U,vp])
viewport=gl('glViewport',None,[I,I,I,I]);draw=gl('glDrawArrays',None,[U,I,I]);finish=gl('glFinish',None,[]);read=gl('glReadPixels',None,[I,I,I,I,U,U,vp])
def shader(kind,src):
    sh=createShader(kind);string=C.c_char_p(src.encode());shaderSource(sh,1,C.byref(string),None);compileShader(sh)
    status=I();getShader(sh,0x8B81,C.byref(status))
    if not status.value:
        log=C.create_string_buffer(12000);shaderLog(sh,len(log),None,log);raise RuntimeError(log.value.decode())
    return sh
vert='#version 330 core\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}'
start=time.time();program=createProgram()
attach(program,shader(0x8B31,vert));attach(program,shader(0x8B30,(ROOT/'duel.frag').read_text()))
link(program);status=I();getProgram(program,0x8B82,C.byref(status))
if not status.value:
    log=C.create_string_buffer(12000);programLog(program,len(log),None,log);raise RuntimeError(log.value.decode())
use(program);vao=U();genVA(1,C.byref(vao));bindVA(vao)

uniform3f=gl('glUniform3f',None,[I,F,F,F])
clashes=[.86,1.79,3.16]
uniform3f(getUniform(program,b'uClashes'),*clashes)
uniform2f(getUniform(program,b'uResolution'),args.width,args.height)
viewport(0,0,args.width,args.height)
rgba=np.zeros((args.height,args.width,4),dtype=np.uint8)
def render_frame(t,samples):
    acc=np.zeros_like(rgba,dtype=np.float32)
    for i in range(samples):
        offset=((i+.5)/samples-.5)/90
        uniform1f(getUniform(program,b'uTime'),max(0,t+offset))
        uniform2f(getUniform(program,b'uJitter'),((i*.618)%1)-.5,((i*.414)%1)-.5)
        draw(0x0004,0,3);finish();read(0,0,args.width,args.height,0x1908,0x1401,rgba.ctypes.data_as(vp));acc+=rgba
    return np.flipud(np.uint8(np.clip(acc/samples,0,255)))
if args.output.suffix.lower()=='.png':
    arr=render_frame(.86,args.samples)
    Image.fromarray(arr,'RGBA').save(args.output)
    print('Still ready:',args.output,'seconds',round(time.time()-start,2),flush=True)
else:
    command=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{args.width}x{args.height}','-r','60','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(args.output)]
    encoder=subprocess.Popen(command,stdin=subprocess.PIPE)
    for frame in range(480):
        arr=render_frame(frame/60,args.samples)
        encoder.stdin.write(arr.tobytes())
        if frame%60==0:print('Core frame',frame,'/480 elapsed',round(time.time()-start,1),flush=True)
    encoder.stdin.close()
    if encoder.wait():raise RuntimeError('Video encoder failed')
    print('Core ready:',args.output,flush=True)
