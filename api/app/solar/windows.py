from datetime import datetime

def parse_utc(value):
    return datetime.fromisoformat(value.replace('Z','+00:00'))

def visibility_metrics(samples, end_utc):
    """Left sample represents each half-open cell [t_i,t_(i+1)).

    Final endpoint is a graph sample only and contributes no extra duration.
    Equality to horizon is defined as not visible by the caller.
    """
    if len(samples)<2: raise ValueError('At least two chronological samples are required.')
    times=[parse_utc(s['t_utc']) for s in samples]
    stop=parse_utc(end_utc)
    if any(b<=a for a,b in zip(times,times[1:])): raise ValueError('Samples must be strictly chronological.')
    if times[-1] != stop: raise ValueError('The final sample must equal the requested end UTC.')
    windows=[]; start=None; visible_hours=0.0; longest_dark=0.0; dark=0.0
    for i in range(len(samples)-1):
        duration=(times[i+1]-times[i]).total_seconds()/3600
        if samples[i]['visible']:
            visible_hours+=duration
            dark=0
            if start is None: start=i
        else:
            dark+=duration; longest_dark=max(longest_dark,dark)
            if start is not None:
                windows.append({'start_utc':samples[start]['t_utc'],'end_utc':samples[i]['t_utc'],'duration_hours':(times[i]-times[start]).total_seconds()/3600})
                start=None
    if start is not None:
        windows.append({'start_utc':samples[start]['t_utc'],'end_utc':end_utc,'duration_hours':(stop-times[start]).total_seconds()/3600})
    total=(stop-times[0]).total_seconds()/3600
    return windows, {'sun_visible_hours':round(visible_hours,6),'sun_visible_fraction':round(visible_hours/total,8),'longest_dark_gap_hours':round(longest_dark,6),'duration_hours':total,'window_count':len(windows)}
