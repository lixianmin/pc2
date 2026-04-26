client<llm> Glm5Turbo {
  provider openai-generic
  options {
    model "glm-5-turbo"
    base_url env.GLM_BASE_URL
    api_key env.GLM_API_KEY
    default_role "user"
  }
}
