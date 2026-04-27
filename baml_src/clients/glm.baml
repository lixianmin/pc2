

client<llm> GLM47 {
  provider openai
  retry_policy Exponential
  options {
    model "glm-4.7"
    api_key env.GLM_API_KEY
    base_url env.GLM_BASE_URL
  }
}

client<llm> Glm5Turbo {
  provider openai
  retry_policy Exponential
  options {
    model "glm-5-turbo"
    api_key env.GLM_API_KEY
    base_url env.GLM_BASE_URL
  }
}


client<llm> Glm51 {
  provider openai
  retry_policy Exponential
  options {
    model "glm-5.1"
    api_key env.GLM_API_KEY
    base_url env.GLM_BASE_URL
  }
}
