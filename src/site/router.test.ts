import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigate } from './router';

afterEach(()=>vi.unstubAllGlobals());
describe('formula variant navigation',()=> {
  function mount(search:string, native=false) {
    const location={pathname:'/library/cfop/gan-pll-01',search,hash:native?`#/library/cfop/gan-pll-01${search}`:''};
    const history={state:{axisNavigationDepth:2},pushState:vi.fn((_state:unknown,_title:string,href:string)=> {
      if(href.startsWith('#'))location.hash=href;
      else {const url=new URL(href,'https://axis.local');location.pathname=url.pathname;location.search=url.search;}
    }),replaceState:vi.fn()};
    vi.stubGlobal('location',location);vi.stubGlobal('history',history);
    vi.stubGlobal('window',{dispatchEvent:vi.fn(),Capacitor:{isNativePlatform:()=>native}});
    return {history,location};
  }
  it('clears the alternative query when returning to the main formula on the same path',()=> {
    const {history,location}=mount('?variant=1');
    navigate('/library/cfop/gan-pll-01');
    expect(history.pushState).toHaveBeenCalledWith({axisNavigationDepth:3},'', '/library/cfop/gan-pll-01');
    expect(location.search).toBe('');
    navigate('/library/cfop/gan-pll-01');
    expect(history.pushState).toHaveBeenCalledTimes(1);
  });
  it('does not add a duplicate entry for an unchanged alternative',()=> {
    const {history}=mount('?variant=1');
    navigate('/library/cfop/gan-pll-01?variant=1');
    expect(history.pushState).not.toHaveBeenCalled();
  });
  it('retains hash-route variant handling for existing native links',()=> {
    const {history,location}=mount('?variant=1',true);
    navigate('/library/cfop/gan-pll-01');
    expect(location.hash).toBe('#/library/cfop/gan-pll-01');
    expect(history.pushState.mock.calls[0][2]).toBe('#/library/cfop/gan-pll-01');
  });
});
