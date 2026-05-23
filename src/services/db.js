import { supabase } from '../lib/supabase';

/**
 * ==========================================
 * USER SETTINGS
 * ==========================================
 */
export async function fetchCloudSettings(userId) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('user_settings')
    .select('settings')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is "Rows not found"
    console.error('Error fetching settings:', error);
    return null;
  }
  return data?.settings || null;
}

export async function saveCloudSettings(userId, settings) {
  if (!supabase) return;
  const { error } = await supabase
    .from('user_settings')
    .upsert({ id: userId, settings, updated_at: new Date().toISOString() });
    
  if (error) console.error('Error saving settings:', error);
}

/**
 * ==========================================
 * PROJECTS
 * ==========================================
 */
export async function fetchProjects() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching projects:', error);
    return [];
  }
  return data;
}

export async function createProject(userId, name) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('projects')
    .insert([{ owner_id: userId, name }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteProject(projectId) {
  if (!supabase) return;
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId);
  if (error) throw error;
}

/**
 * ==========================================
 * FILES
 * ==========================================
 */
export async function fetchProjectFiles(projectId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('project_id', projectId);

  if (error) {
    console.error('Error fetching files:', error);
    return [];
  }
  return data;
}

export async function saveFileToCloud(projectId, path, name, content, language) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('files')
    .upsert(
      { 
        project_id: projectId, 
        path, 
        name, 
        content, 
        language,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'project_id, path' }
    )
    .select()
    .single();

  if (error) throw error;
  
  // Update project updated_at
  await supabase
    .from('projects')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', projectId);

  return data;
}

export async function deleteFileFromCloud(projectId, path) {
  if (!supabase) return;
  const { error } = await supabase
    .from('files')
    .delete()
    .eq('project_id', projectId)
    .eq('path', path);
  if (error) throw error;
}
