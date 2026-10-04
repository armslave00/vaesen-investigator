// Optional browser-native tools. Both actions use the same source formulas,
// validation and saved state as the visible card; unsupported browsers skip it.
export async function registerCardTools(context, actions, signal) {
  if(!context?.registerTool)return false;
  const tools=[
    {name:'read_investigator_card',title:'读取调查员档案',description:'读取当前调查员输入与按原 Excel 公式重算的结果。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>actions.read()},
    {name:'update_investigator_fields',title:'填写调查员档案',description:'批量更新可编辑的原卡单元格，立即重算并保存当前浏览器的档案。键格式为角色卡!D16。',inputSchema:{type:'object',properties:{values:{type:'object',additionalProperties:{type:['string','number','boolean','null']}}},required:['values'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:(input)=>{
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='values')||!input.values||typeof input.values!=='object'||Array.isArray(input.values))throw new Error('必须提供可编辑单元格 values 对象');
      return actions.update(input.values);
    }},
  ];
  for(const tool of tools)await context.registerTool(tool,{signal});
  return true;
}
